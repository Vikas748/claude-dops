import json, urllib.request, glob, email, re, subprocess, time, os
B="http://127.0.0.1:3100"
def call(method, path, body=None, cookie=None, bearer=None):
    h={"content-type":"application/json"}
    if cookie: h["cookie"]=cookie
    if bearer: h["authorization"]="Bearer "+bearer
    r=urllib.request.Request(B+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: resp=urllib.request.urlopen(r); code=resp.status
    except urllib.error.HTTPError as e: resp=e; code=e.code
    raw=resp.read().decode(); sc=resp.headers.get_all("set-cookie") or []
    try: data=json.loads(raw)
    except: data=raw[:80]
    return code, data, sc
def sql(q): return subprocess.run(["su","postgres","-c",f"psql -tAc \"{q}\""],capture_output=True,text=True).stdout.strip()
def mails(): return sorted(glob.glob("/tmp/mails/*.eml"), key=os.path.getmtime)
def last_code():
    m=email.message_from_bytes(open(mails()[-1],'rb').read()); return re.match(r"(\d{6})", m["Subject"]).group(1), m["To"]
def age_otps(): sql("update auth_otps set created_at=created_at - interval '2 minutes'")
ok=lambda c,msg: print(("PASS " if c else "FAIL ")+msg)

c,d,_=call("POST","/api/auth/request-otp",{"email":"stranger@x.com"}); ok(c==200 and len(mails())==0, f"1 unknown email -> {c}, generic reply, no mail sent")
c,d,_=call("POST","/api/auth/request-otp",{"email":"head.dept@hospital.in"}); code,to=last_code(); ok(c==200 and len(mails())==1, f"2 bootstrap admin (case-insensitive) -> {c}, mail to {to}")
c,d,_=call("POST","/api/auth/request-otp",{"email":"head.dept@hospital.in"}); ok(c==429, f"3 immediate resend -> {c}: {d.get('message')}")
wrong="000000" if code!="000000" else "111111"
c,d,_=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":wrong}); ok(c==401, f"4 wrong code -> {c}: {d['message']}")
c,d,sc=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":code}); cookie=[x for x in sc if x.startswith("dops_session=")][0].split(";")[0]
ok(c==200 and d["user"]["role"]=="ADMIN" and "token" not in d, f"5 correct code -> {c}, role {d['user']['role']}, web gets cookie only (HttpOnly={'HttpOnly' in sc[0]})")
c,d,_=call("GET","/api/access",cookie=cookie); ok(c==200 and d["data"]["role"]=="ADMIN", f"6 /api/access with cookie -> {c} {d['data']['authMethod']}")
c,d,_=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":code}); ok(c==401, f"7 reuse same code -> {c}: {d['message']}")
c,d,_=call("GET","/api/patients",cookie=cookie); ok(c==200, f"8 existing module API (patients) still works -> {c}")
c,d,_=call("POST","/api/admin",{"name":"Dr Resident","email":"Res.One@hospital.in","role":"RESIDENT","status":"ACTIVE","permissions":["OPD:VIEW"]},cookie=cookie); ok(c==200, f"9 admin creates user -> {c}")
c,d,_=call("POST","/api/admin",{"name":"Dr Pending","email":"pending@hospital.in","role":"RESIDENT","status":"PENDING","permissions":[]},cookie=cookie)
n=len(mails()); c,d,_=call("POST","/api/auth/request-otp",{"email":"pending@hospital.in"}); ok(c==200 and len(mails())==n, f"10 PENDING user -> {c}, no mail sent")
c,d,_=call("POST","/api/auth/request-otp",{"email":"res.one@hospital.in"}); code,_=last_code()
c,d,_=call("POST","/api/auth/verify-otp",{"email":"res.one@hospital.in","code":code,"client":"MOBILE"}); tok=d.get("token")
ok(c==200 and tok, f"11 mobile login -> {c}, token returned, expiresAt {str(d.get('expiresAt'))[:10]}")
c,d,_=call("GET","/api/access",bearer=tok); ok(c==200 and d["data"]["permissions"]==["OPD:VIEW"], f"12 Bearer token access -> {c}, perms {d['data']['permissions']}")
c,d,_=call("GET","/api/admin/system",bearer=tok); ok(c in (401,403), f"13 resident blocked from admin API -> {c}")
uid=sql("select id from department_users where email='res.one@hospital.in'")
c,d,_=call("POST","/api/admin",{"id":int(uid),"name":"Dr Resident","email":"res.one@hospital.in","role":"RESIDENT","status":"INACTIVE","permissions":["OPD:VIEW"]},cookie=cookie)
c,d,_=call("GET","/api/access",bearer=tok); live=sql(f"select count(*) from auth_sessions where user_id={uid} and revoked_at is null")
ok(c==401 and live=="0", f"14 admin deactivates -> token instantly rejected ({c}), live sessions={live}")
age_otps(); c,d,_=call("POST","/api/admin",{"id":int(uid),"name":"Dr Resident","email":"res.one@hospital.in","role":"RESIDENT","status":"ACTIVE","permissions":["OPD:VIEW"]},cookie=cookie)
call("POST","/api/auth/request-otp",{"email":"res.one@hospital.in"}); code,_=last_code()
msgs=[call("POST","/api/auth/verify-otp",{"email":"res.one@hospital.in","code":f"{(int(code)+i)%1000000:06d}"})[1]["message"] for i in range(1,6)]
c,d,_=call("POST","/api/auth/verify-otp",{"email":"res.one@hospital.in","code":code}); ok(c==401, f"15 5 wrong guesses -> locked; last msg '{msgs[-1]}'; correct code afterwards -> {c}")
sql("update auth_otps set expires_at=now()-interval '1 second' where consumed_at is null")
age_otps(); call("POST","/api/auth/request-otp",{"email":"res.one@hospital.in"}); code,_=last_code(); sql("update auth_otps set expires_at=now()-interval '1 second' where consumed_at is null")
c,d,_=call("POST","/api/auth/verify-otp",{"email":"res.one@hospital.in","code":code}); ok(c==401, f"16 expired code -> {c}: {d['message']}")
for i in range(3): age_otps(); call("POST","/api/auth/request-otp",{"email":"res.one@hospital.in"})
age_otps(); c,d,_=call("POST","/api/auth/request-otp",{"email":"res.one@hospital.in"}); ok(c==429, f"17 hourly per-email limit -> {c}: {d['message']}")
c,d,_=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":"12ab56"}); ok(c==400, f"18 malformed code -> {c}")
r=urllib.request.Request(B+"/api/auth/request-otp",data=b'{"email":"a@b.co"}',headers={"content-type":"application/json","origin":"https://evil.com"},method="POST")
try: urllib.request.urlopen(r); c=200
except urllib.error.HTTPError as e: c=e.code
ok(c==403, f"19 cross-site request blocked -> {c}")
print("   DB check: otp codes stored in plain?", sql(f"select count(*) from auth_otps where code_hash ~ '^[0-9]{{6}}$'"), "| raw token in DB?", sql(f"select count(*) from auth_sessions where token_hash='{cookie.split('=')[1]}'"))
c,d,_=call("GET","/api/auth/logout",cookie=cookie); c2,_,_=call("GET","/api/access",cookie=cookie); ok(c2==401, f"20 logout -> old cookie now {c2}")
print("   audit:", sql("select string_agg(action,', ' order by id) from audit_logs where module='AUTH'"))
