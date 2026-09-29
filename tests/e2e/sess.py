import glob, email, re, time, os, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright
def skip_pin(pg, timeout=15000):
    """After the email code, DOPS offers to set a PIN; these tests choose "Skip for now"."""
    pg.wait_for_function("location.pathname === '/' || document.body.innerText.includes('Set a quick PIN')", timeout=timeout)
    if "Set a quick PIN" in pg.inner_text("body"):
        pg.click("text=Skip for now")
        pg.wait_for_url("http://localhost:3100/", timeout=timeout)

exec(open('/tmp/flow.py').read().split("ok=lambda")[0])
def ok(c,m): print(("PASS " if c else "FAIL ")+m)
def code():
    f=sorted(glob.glob("/tmp/mails/*.eml"),key=os.path.getmtime)[-1]; return re.match(r"(\d{6})", email.message_from_bytes(open(f,'rb').read())["Subject"]).group(1)
def nav(pg,x): pg.locator("[data-sidebar=menu-button]").filter(has_text=re.compile(f"^\\s*{x}\\s*$")).first.click(); time.sleep(1)
def login(pg, addr):
    sql("update auth_otps set created_at=created_at - interval '3 hours'")
    pg.goto("http://localhost:3100/login"); pg.fill("input[type=email]",addr); pg.click("text=Send code")
    pg.wait_for_selector("text=Enter your code"); time.sleep(0.3); pg.keyboard.type(code()); skip_pin(pg); pg.wait_for_load_state("networkidle")
# admin (API) creates a nurse
sql("update auth_otps set created_at=created_at - interval '3 hours'")
call("POST","/api/auth/request-otp",{"email":"head.dept@hospital.in"}); c0,_=last_code()
_,_,sc=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":c0}); admin=[x for x in sc if x.startswith("dops_session=")][0].split(";")[0]
call("POST","/api/admin",{"name":"Nurse Asha","email":"asha@hospital.in","role":"NURSE","status":"ACTIVE","permissions":["OPD:VIEW","WARD:VIEW","CLASS:VIEW"]},cookie=admin)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    # S1: session revoked while working -> next action goes to login with message
    pg=b.new_context().new_page(); login(pg,"asha@hospital.in"); nav(pg,"OPD")
    sql("update auth_sessions set revoked_at=now() where revoked_at is null and user_id=(select id from department_users where email='asha@hospital.in')")
    nav(pg,"Class"); pg.wait_for_url("**/login?expired=1",timeout=10000); time.sleep(0.8)
    ok(pg.url.endswith("/login?expired=1") and "Your session has ended" in pg.inner_text(".auth-card"), f"S1 session revoked mid-work -> next click lands on {pg.url.split('3100')[1]} with message")
    # S2: admin deactivates the nurse while she is working
    login(pg,"asha@hospital.in"); nav(pg,"Ward")
    uid=int(sql("select id from department_users where email='asha@hospital.in'"))
    call("POST","/api/admin",{"id":uid,"name":"Nurse Asha","email":"asha@hospital.in","role":"NURSE","status":"INACTIVE","permissions":["OPD:VIEW"]},cookie=admin)
    nav(pg,"OPD"); pg.wait_for_url("**/login?expired=1",timeout=10000)
    ok(True, "S2 admin deactivates user -> her next action signs her out")
    call("POST","/api/admin",{"id":uid,"name":"Nurse Asha","email":"asha@hospital.in","role":"NURSE","status":"ACTIVE","permissions":["OPD:VIEW","WARD:VIEW","CLASS:VIEW"]},cookie=admin)
    # S3: a 403 (no permission) must NOT sign the user out
    login(pg,"asha@hospital.in")
    st=pg.evaluate("fetch('/api/special?kind=LEPROSY&from=2026-01-01&to=2026-12-31').then(r=>r.status)"); time.sleep(1.5)
    ok(st==403 and pg.url=="http://localhost:3100/", f"S3 forbidden module -> {st}, user stays signed in")
    # S4: wrong code on the login page is a 401 but must not bounce anywhere
    pg2=b.new_context().new_page(); sql("update auth_otps set created_at=created_at - interval '3 hours'")
    pg2.goto("http://localhost:3100/login"); pg2.fill("input[type=email]","asha@hospital.in"); pg2.click("text=Send code"); pg2.wait_for_selector("text=Enter your code"); time.sleep(0.3)
    good=code(); pg2.keyboard.type(f"{(int(good)+1)%1000000:06d}"); pg2.wait_for_selector(".auth-message.is-error"); time.sleep(1)
    ok(pg2.url.endswith("/login") and "Incorrect code" in pg2.inner_text(".auth-message"), "S4 wrong OTP (401) stays on the login page with its error")
    b.close()
