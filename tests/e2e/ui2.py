import os
import glob, email, re, time
from playwright.sync_api import sync_playwright
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

def latest_code():
    f=sorted(glob.glob("/tmp/mails/*.eml"))[-1]; return re.match(r"(\d{6})", email.message_from_bytes(open(f,'rb').read())["Subject"]).group(1)
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
def login(pg, addr):
    pg.goto("http://localhost:3100/login"); to_email(pg); pg.fill("input[type=email]", addr); pg.click("text=Send code")
    pg.wait_for_selector("text=Enter your code"); time.sleep(0.3); pg.keyboard.type(latest_code()); skip_pin(pg); pg.wait_for_load_state("networkidle")
def session_cookie(ctx): return [c["value"] for c in ctx.cookies() if c["name"]=="dops_session"]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    # A: stale/garbage cookie (e.g. old session after DB reset) -> must land on login, not loop
    ctx=b.new_context(); pg=ctx.new_page(); navs=[]
    pg.on("framenavigated", lambda f: navs.append(f.url) if f==pg.main_frame else None)
    ctx.add_cookies([{"name":"dops_session","value":"stale-token-from-old-deploy","url":"http://localhost:3100"}])
    pg.goto("http://localhost:3100/"); pg.wait_for_url("**/login?**", timeout=10000); time.sleep(4)
    ok("/login?" in pg.url and len(navs)<=4, f"A stale cookie -> {pg.url} after {len(navs)} navigations, then stable 4s (no loop)")
    ok(session_cookie(ctx)==[], "A stale cookie cleared from browser")
    ok("Your session has ended" in pg.inner_text(".auth-message"), f"A notice: '{pg.inner_text('.auth-message')}'")
    pg.screenshot(path="/tmp/shots/expired.png")
    # B: normal login, then session revoked server-side (admin deactivation / logout elsewhere)
    login(pg, "head.dept@hospital.in"); ok(pg.url=="http://localhost:3100/", "B login after expiry works")
    import subprocess; subprocess.run(["su","postgres","-c","psql -qc \"update auth_sessions set revoked_at=now() where revoked_at is null\""])
    pg.reload(); pg.wait_for_url("**/login?expired=1", timeout=10000); time.sleep(2)
    ok(pg.url.endswith("/login?expired=1") and session_cookie(ctx)==[], f"B revoked session on reload -> {pg.url.split('3100')[1]}, cookie cleared")
    # C: sign-out link
    subprocess.run(["su","postgres","-c","psql -qc \"update auth_otps set created_at=created_at - interval '3 hours'\""])
    login(pg, "head.dept@hospital.in"); pg.click("a.signout-link"); pg.wait_for_url("**/login"); time.sleep(1)
    ok(pg.url.endswith("/login") and session_cookie(ctx)==[], f"C sign-out link -> {pg.url.split('3100')[1]}, cookie cleared, no expired notice: {pg.query_selector('.auth-message') is None}")
    pg.goto("http://localhost:3100/"); ok(pg.url.endswith("/login"), "C after sign-out, / is protected")
    b.close()
