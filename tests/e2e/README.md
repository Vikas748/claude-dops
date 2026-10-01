# DOPS end-to-end tests

These suites run the **production build** against a **real PostgreSQL** database, with small local stand-ins for Supabase Storage (`mock_storage.py`) and the SMTP server (`mock_smtp.py`). They are separate from `pnpm test` (fast source checks) because they need a database.

```bash
sudo tests/e2e/run.sh              # API suites, about 3 minutes
sudo tests/e2e/run.sh --browser    # plus the browser (Playwright) suites
```

Requirements: Linux, PostgreSQL 14+ running locally, `pnpm`, `openssl`, Python 3.10+ with `pip install aiosmtpd playwright openpyxl` (then `playwright install chromium`, or set `CHROMIUM_PATH`). The runner **drops and recreates the local `public` schema** — never point it at a real database. Settings are in `.env.e2e` (test-only values).

| Suite | Covers |
|---|---|
| `flow`, `flow2` | Email OTP sign-in, limits, lockout, sessions, Bearer tokens, deactivation, permissions |
| `up` | Direct-to-storage uploads: size/type checks, fake files, reuse, ownership, discharge cards |
| `br` | Backup and restore round trip, including files |
| `search` | Case-insensitive, Hindi, literal `%`/`_` |
| `jobs` | Monthly report email, daily OT reminder, duplicate-run protection |
| `enc` | Aadhaar/bank encryption, masking, masked edits, history permission |
| `audit2` | Audit detail, append-only audit log across restores |
| `ui`, `ui2`, `sess`, `ui_up`, `greet` | Browser: sign-in on desktop/mobile, session expiry, uploads, backup/restore screens, greeting |
| `step7` | Polishing round: Emergency OPD, IPD always ADMITTED, CASE CATEGORY, Ward keeps discharged rows with STATUS, dashboard 5 cards, Age/Sex, month labels, Skin Bank inline editing |
| `step6` | Round 3: OPD No./UHID No. (required, unique, searchable, OPD/IPD/report columns), DD-MM-YYYY, headings, sidebar boxes, dashboard, gap, Skin Bank tabs/status |
| `step5` | Round 2: app lock (PIN on every open, mandatory PIN, server-enforced 423), black/gold theme, capital sidebar, header weights, no formula box, tablet overflow |
| `step4` | Device-bound PIN: setup after email code, PIN sign-in, lockout (also under parallel guessing), deactivation, remove from device |
| `step3` | New logo/icons served publicly, landing sign-in page, request an account, admin notification and approval email |
| `step2` | Optional PDF for Class/Research/Publication; edit, add or replace the PDF later; permissions |
| `step1` | Client changes round 1: header/sidebar text, CM Helpline from Ward only, Pending/Resolved, Leprosy summary, register switching |

The mocks follow the request/response formats of Supabase Storage and SMTP, but they are not the real services: after deploying, also run `/api/health?deep=1` (see `docs/VERCEL_DEPLOYMENT.md`).
