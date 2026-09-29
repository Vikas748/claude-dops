import os
# Client change round 1, step 3: logo/icons, landing sign-in page, request an account + approval
exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
import email as em, glob
from playwright.sync_api import sync_playwright
def mail_for(subject_part):
    for f in sorted(glob.glob("/tmp/mails/*.eml"),key=os.path.getmtime,reverse=True):
        m=em.message_from_bytes(open(f,'rb').read())
        if subject_part in (m["Subject"] or ""): return m, open(f.replace(".eml",".rcpt")).read().split(",")
    return None, []
admin=web_login("head.dept@hospital.in")
# ---- brand assets are public (the sign-in page shows them before login) ----
for path in ["/brand/dops-logo-full.png","/brand/icon-192.png","/brand/favicon-64.png"]:
    s,b,h=raw("GET",B+path,follow=False); ok(s==200 and b[:4]==b"\x89PNG", f"R1 {path} served without sign-in ({s})")
s,b,_=raw("GET",B+"/manifest.webmanifest"); ok(b'"/brand/icon-512.png"' in b and b'"#0c1b33"' in b, "R2 app manifest uses the new icons and navy colour")
# ---- request an account ----
REQ={"name":"Dr Asha Verma","email":"Asha.Verma@hospital.in","mobile":"98765 43210","role":"RESIDENT","note":"Senior Resident, Burns"}
c,d,_=call("POST","/api/auth/request-account",{**REQ,"role":"ADMIN"}); ok(c==400, f"R3 cannot request ADMIN role -> {c}")
c,d,_=call("POST","/api/auth/request-account",{**REQ,"mobile":"123"}); ok(c==400, f"R4 invalid mobile -> {c}: {d['message']}")
c,d,_=call("POST","/api/auth/request-account",{**REQ,"email":"bot@spam.io","website":"http://spam"}); ok(c==200 and sql("select count(*) from department_users where email='bot@spam.io'")=="0", "R5 bot filling the hidden field is ignored")
c,d,_=call("POST","/api/auth/request-account",REQ)
row=sql("select status||'|'||role||'|'||mobile||'|'||permissions from department_users where email='asha.verma@hospital.in'")
ok(c==200 and row=="PENDING|RESIDENT|9876543210|[]", f"R6 request saved as PENDING with no permissions ({row})")
m,rc=mail_for("new account request"); ok(m is not None and "head.dept@hospital.in" in rc, f"R7 active admins emailed (BCC {rc})")
c,d2,_=call("POST","/api/auth/request-account",REQ); ok(c==200 and d2["message"]==d["message"] and sql("select count(*) from department_users where email='asha.verma@hospital.in'")=="1", "R8 repeat request: same reply, no duplicate (email existence not revealed)")
n=len(glob.glob("/tmp/mails/*.eml")); c,_,_=call("POST","/api/auth/request-otp",{"email":"asha.verma@hospital.in"}); ok(len(glob.glob("/tmp/mails/*.eml"))==n, "R9 pending user gets no sign-in code")
uid=int(sql("select id from department_users where email='asha.verma@hospital.in'"))
call("POST","/api/admin",{"id":uid,"name":"Dr Asha Verma","email":"asha.verma@hospital.in","mobile":"9876543210","role":"RESIDENT","status":"ACTIVE","permissions":["OPD:VIEW"]},cookie=admin)
m,rc=mail_for("Your DOPS access is ready"); ok(m is not None and rc==["asha.verma@hospital.in"], "R10 approval email sent to the user")
fresh(); c,_,_=call("POST","/api/auth/request-otp",{"email":"asha.verma@hospital.in"}); code,_=last_code(); c,d,_=call("POST","/api/auth/verify-otp",{"email":"asha.verma@hospital.in","code":code})
ok(c==200 and d["user"]["role"]=="RESIDENT", "R11 approved user can sign in")
ok("ACCOUNT_REQUEST" in sql("select string_agg(action,',') from audit_logs"), "R12 request recorded in the audit log")
# ---- browser: landing page ----
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None); pg=b.new_page(viewport={"width":1440,"height":860})
    pg.goto("http://localhost:3100/login"); time.sleep(1.2)
    ok(pg.evaluate("(()=>{const i=document.querySelector('.login-logo');return i&&i.complete&&i.naturalWidth>0})()"), "B1 logo loads on the sign-in page")
    t=pg.inner_text("body"); ok("Plastic & Reconstructive Surgery Department Management" in t and "NSCB MEDICAL COLLEGE, JABALPUR" in t and "Request an account" in t, "B2 landing content: heading, college, request link")
    pg.click("text=Request an account"); pg.fill("input[name=name]","Nurse Kavita"); pg.fill("form input[name=email]","kavita@hospital.in"); pg.fill("input[name=mobile]","9812300001"); pg.select_option("select[name=role]","NURSE")
    pg.click("button:has-text('Send request')"); pg.wait_for_selector("text=Request sent",timeout=10000)
    ok("kavita@hospital.in" in pg.inner_text(".login-success") and sql("select status from department_users where email='kavita@hospital.in'")=="PENDING", "B3 request from the page: confirmation shown, user PENDING")
    pg.click("button:has-text('Back to sign in')"); ok(pg.locator("text=Send code").count()==1, "B4 back to sign in")
    ok(pg.evaluate("[...document.querySelectorAll('link[rel~=icon]')].some(l=>l.href.includes('/brand/favicon-64.png'))"), "B5 browser tab icon is the new logo")
    b.close()
print(f"TOTAL: {R['pass']} passed, {R['fail']} failed")
