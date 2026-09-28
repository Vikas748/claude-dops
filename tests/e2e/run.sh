#!/bin/bash
# DOPS end-to-end suite: real PostgreSQL + production build + local mocks of
# Supabase Storage and SMTP. Linux only; needs root (uses `su postgres`).
#
# Requirements: PostgreSQL 14+ running locally, Python 3.10+ with
#   pip install aiosmtpd playwright openpyxl   (and `playwright install chromium`
#   or set CHROMIUM_PATH), openssl, pnpm.
#
#   tests/e2e/run.sh            API suites (~2-3 minutes)
#   tests/e2e/run.sh --browser  also the browser (Playwright) suites
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$REPO/tests/e2e"
cd "$REPO"

echo "== preparing"
cp "$HERE"/*.py /tmp/ && python3 /tmp/make_files.py && mkdir -p /tmp/mails /tmp/shots && rm -f /tmp/mails/*
[ -f /tmp/c.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/k.pem -out /tmp/c.pem -days 30 -subj /CN=localhost 2>/dev/null
su postgres -c "psql -q -c \"ALTER USER postgres PASSWORD 'testpw';\"" >/dev/null
cat > /tmp/reset.sh <<RESET
#!/bin/bash
cd "$REPO"
su postgres -c "psql -q -c 'drop schema public cascade; create schema public;'" 2>/dev/null
su postgres -c "psql -q -c 'create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public bool,file_size_limit bigint);'" 2>/dev/null
su postgres -c "psql -q -v ON_ERROR_STOP=1 -f supabase/schema.sql $(ls "$REPO"/supabase/migrations/*.sql | sed 's/^/-f /' | tr '\n' ' ')" 2>&1 | grep -i error
curl -s -X POST http://127.0.0.1:9100/_debug/reset >/dev/null 2>&1; rm -f /tmp/mails/*
RESET
chmod +x /tmp/reset.sh

pgrep -f "python3 /tmp/mock_storage.py" >/dev/null || (setsid nohup python3 /tmp/mock_storage.py >/tmp/mock.out 2>&1 </dev/null &)
pgrep -f "python3 /tmp/mock_smtp.py" >/dev/null || (setsid nohup python3 /tmp/mock_smtp.py >/tmp/smtp.out 2>&1 </dev/null &)
sleep 2

echo "== building"
set -a; . "$HERE/.env.e2e"; set +a
pnpm build >/tmp/e2e-build.log 2>&1 || { echo "build failed, see /tmp/e2e-build.log"; exit 1; }
setsid nohup pnpm start -p 3100 >/tmp/e2e-next.log 2>&1 </dev/null &
APP=$!; sleep 8

: >/tmp/e2e-results.txt
run(){ echo "===== $1" >>/tmp/e2e-results.txt; timeout 300 python3 /tmp/$1.py >>/tmp/e2e-results.txt 2>&1; echo "   $1: $(grep -c '^PASS' /tmp/e2e-results.txt) passed so far"; }
fresh(){ /tmp/reset.sh >/dev/null; }
# Some suites build on data from the previous one; others need an empty database.
fresh; run flow; run flow2; run up
sleep 61; run br                     # admin recovery actions are limited to 6/minute
fresh; run search
fresh; run jobs
fresh; run enc
fresh; sleep 61; run audit2
if [ "${1:-}" = "--browser" ]; then
  fresh; run ui; fresh; run ui2; fresh; run sess
  fresh; python3 /tmp/ui_setup.py >/dev/null 2>&1; run ui_up
  fresh; run greet
  fresh; run step1
  fresh; run step2
fi
pkill -P $APP 2>/dev/null; kill $APP 2>/dev/null
echo
echo "PASS: $(grep -c '^PASS' /tmp/e2e-results.txt)   FAIL: $(grep -c '^FAIL' /tmp/e2e-results.txt)   (details: /tmp/e2e-results.txt)"
grep -E '^FAIL|Traceback' /tmp/e2e-results.txt && exit 1 || exit 0
