import os
# Client change round 1, step 4: quick sign-in with a device-bound 4-digit PIN
def skip_pin(pg, timeout=15000):
    """After the email code DOPS may require a PIN (mandatory): set 2580, then continue."""
    pg.wait_for_function("location.pathname === '/' || document.body.innerText.includes('Set your PIN')", timeout=timeout)
    if "Set your PIN" in pg.inner_text("body"):
        pg.locator("#pin-new").focus(); pg.keyboard.type("2580")
        pg.locator("#pin-confirm").focus(); pg.keyboard.type("2580")
        pg.click("button:has-text('Save PIN')")
        pg.wait_for_url("http://localhost:3100/", timeout=timeout)

def to_email(pg, timeout=6000):
    """The sign-in page may open on the PIN screen (a PIN exists on this browser); tests use the email code."""
    try:
        pg.wait_for_function("document.body.innerText.includes('Send code') || document.body.innerText.includes('Forgot PIN?') || location.pathname === '/'", timeout=timeout)
    except Exception:
        return
    if pg.locator("text=Forgot PIN? Use email code").count():
        pg.click("text=Forgot PIN? Use email code")

exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
import concurrent.futures
from playwright.sync_api import sync_playwright
def ck(sc,name): return next((x.split(";")[0] for x in sc if x.startswith(name+"=")),None)
def otp(addr):
    fresh(); call("POST","/api/auth/request-otp",{"email":addr}); code,_=last_code()
    c,d,sc=call("POST","/api/auth/verify-otp",{"email":addr,"code":code})
    # session + the 10-minute PIN-setup ticket issued with the email code
    return d, "; ".join(x for x in [ck(sc,"dops_session"),ck(sc,"dops_pin_setup")] if x)
d,sess=otp("head.dept@hospital.in"); ok(d.get("requirePin") is True, "P1 first sign-in on a device requires a PIN")
c,d,_=call("POST","/api/auth/pin",{"action":"setup","pin":"1234","confirm":"1234"},cookie=sess); ok(c==400, f"P2 weak PIN refused: {d['message']}")
c,d,_=call("POST","/api/auth/pin",{"action":"setup","pin":"2580","confirm":"2581"},cookie=sess); ok(c==400, f"P3 mismatch refused: {d['message']}")
c,d,_=call("POST","/api/auth/pin",{"action":"setup","pin":"2580","confirm":"2580"}); ok(c==401, "P4 cannot set a PIN without signing in")
c,d,sc=call("POST","/api/auth/pin",{"action":"setup","pin":"2580","confirm":"2580"},cookie=sess); dev=ck(sc,"dops_device")
ok(c==200 and dev and "HttpOnly" in [x for x in sc if x.startswith("dops_device=")][0], "P5 PIN set; device cookie is httpOnly")
row=sql("select pin_hash||'|'||token_hash from auth_devices"); ok(row.startswith("scrypt$") and "2580" not in row and dev.split("=")[1] not in row, "P6 only hashes stored (no PIN, no raw device token)")
c,d,sc=call("POST","/api/auth/pin",{"action":"login","pin":"2580"},cookie=dev); ok(c==200 and ck(sc,"dops_session"), "P7 PIN sign-in on this device")
c,d,_=call("GET","/api/access",cookie=f'{ck(sc,"dops_session")}; {ck(sc,"dops_unlock")}'); ok(c==200 and d["data"]["role"]=="ADMIN", "P8 PIN session works (unlocked)")
c,d,_=call("POST","/api/auth/pin",{"action":"login","pin":"2580"}); ok(c==401, "P9 same PIN without the device cookie fails (other devices)")
fresh(); call("POST","/api/auth/request-otp",{"email":"head.dept@hospital.in"}); code,_=last_code()
c,d,_=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":code},cookie=dev); ok(d.get("requirePin") is False, "P10 email sign-in on a device that has a PIN does not ask again")
msgs=[call("POST","/api/auth/pin",{"action":"login","pin":"0000"},cookie=dev) for _ in range(5)]
ok([m[0] for m in msgs]==[401,401,401,401,423] and "1 attempt left" in msgs[3][1]["message"], f"P11 5 wrong PINs -> locked ({[m[0] for m in msgs]})")
c,d,_=call("POST","/api/auth/pin",{"action":"login","pin":"2580"},cookie=dev); ok(c==423, "P12 correct PIN refused while locked")
c,d,_=call("GET","/api/auth/pin",cookie=dev); ok(d["data"]["locked"] is True and d["data"]["enabled"] is False, "P13 sign-in page is told the PIN is locked")
fresh(); call("POST","/api/auth/request-otp",{"email":"head.dept@hospital.in"}); code,_=last_code()
c,d,sc=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":code},cookie=dev); s2=ck(sc,"dops_session"); ticket=ck(sc,"dops_pin_setup")
ok(d.get("requirePin") is True, "P14 after a lock, email sign-in requires a new PIN")
_,_,scs=call("POST","/api/auth/pin",{"action":"setup","pin":"3691","confirm":"3691"},cookie=f"{s2}; {dev}; {ticket}")
c,_,_=call("POST","/api/auth/pin",{"action":"login","pin":"3691"},cookie=dev); ok(c==200 and sql("select count(*) from auth_devices")=="1", "P15 new PIN replaces the locked one on the same device")
with concurrent.futures.ThreadPoolExecutor(10) as ex: codes=[f.result()[0] for f in [ex.submit(call,"POST","/api/auth/pin",{"action":"login","pin":"1111"},dev) for _ in range(10)]]
fa=int(sql("select failed_attempts from auth_devices")); ok(fa<=5 and codes.count(423)>=5, f"P16 10 parallel guesses: counted {fa}, never above 5 ({sorted(codes)})")
sql("update auth_devices set failed_attempts=0, locked_at=null")
admin=f'{s2}; {ck(scs,"dops_unlock")}'; uid=int(sql("select id from department_users where email='head.dept@hospital.in'"))
call("POST","/api/admin",{"name":"Dr Two","email":"two@hospital.in","role":"DOCTOR","status":"ACTIVE","permissions":["OPD:VIEW"]},cookie=admin)
d2,s3=otp("two@hospital.in"); _,_,sc=call("POST","/api/auth/pin",{"action":"setup","pin":"4826","confirm":"4826"},cookie=s3); dev2=ck(sc,"dops_device")
tid=int(sql("select id from department_users where email='two@hospital.in'"))
call("POST","/api/admin",{"id":tid,"name":"Dr Two","email":"two@hospital.in","role":"DOCTOR","status":"INACTIVE","permissions":["OPD:VIEW"]},cookie=admin)
c,d,_=call("POST","/api/auth/pin",{"action":"login","pin":"4826"},cookie=dev2); ok(c==403, "P17 deactivated user cannot use their PIN")
c,d,sc=call("DELETE","/api/auth/pin",cookie=dev); ok(c==200 and sql(f"select count(*) from auth_devices where user_id={uid}")=="0", "P18 'Remove PIN from this device' deletes it")
ok("PIN_SET" in sql("select string_agg(distinct action,',') from audit_logs") and "PIN_LOCKED" in sql("select string_agg(distinct action,',') from audit_logs"), "P19 PIN set / locked are audited")
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None); ctx=b.new_context(viewport={"width":1280,"height":820}); pg=ctx.new_page()
    fresh(); pg.goto("http://localhost:3100/login"); to_email(pg); pg.fill("input[type=email]","head.dept@hospital.in"); pg.click("text=Send code"); pg.wait_for_selector("text=Enter your code"); time.sleep(0.3)
    pg.keyboard.type(last_code()[0]); pg.wait_for_selector("text=Set your PIN",timeout=10000); pg.screenshot(path="/tmp/shots/s4-setpin.png")
    ok(pg.locator("text=Skip for now").count()==0,"B1 after the email code, the (mandatory) PIN setup screen appears — no Skip")
    pg.locator("#pin-new").focus(); pg.keyboard.type("2580"); pg.locator("#pin-confirm").focus(); pg.keyboard.type("2580"); pg.click("button:has-text('Save PIN')")
    pg.wait_for_url("http://localhost:3100/",timeout=10000); ok(True,"B2 PIN saved, dashboard opens")
    pg.click("a.signout-link"); pg.wait_for_url("**/login"); pg.wait_for_selector("text=Welcome back",timeout=10000); time.sleep(0.5); pg.screenshot(path="/tmp/shots/s4-pin.png")
    ok("h***@hospital.in" in pg.inner_text("body"), "B3 after sign-out: 'Welcome back' with masked email")
    pg.keyboard.type("0000"); pg.wait_for_selector(".auth-message.is-error"); ok("4 attempts left" in pg.inner_text(".auth-message"), "B4 wrong PIN shows attempts left")
    time.sleep(0.5); pg.keyboard.type("2580"); pg.wait_for_url("http://localhost:3100/",timeout=10000); ok(True,"B5 correct PIN signs in")
    pg.click("a.signout-link"); pg.wait_for_selector("text=Welcome back"); pg.click("text=Forgot PIN? Use email code"); ok(pg.locator("text=Send code").count()==1, "B6 'Forgot PIN' goes to email sign-in")
    pg.goto("http://localhost:3100/login"); pg.wait_for_selector("text=Welcome back"); pg.click("text=Remove PIN from this device"); time.sleep(0.8)
    pg.goto("http://localhost:3100/login"); time.sleep(1.5); ok(pg.locator("text=Send code").count()==1 and pg.locator("text=Welcome back").count()==0, "B7 after removing, the device shows normal email sign-in")
    b.close()
print(f"TOTAL: {R['pass']} passed, {R['fail']} failed")
