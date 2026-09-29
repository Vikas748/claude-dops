import os
import glob, email, re, time
from playwright.sync_api import sync_playwright
def skip_pin(pg, timeout=15000):
    """After the email code, DOPS offers to set a PIN; these tests choose "Skip for now"."""
    pg.wait_for_function("location.pathname === '/' || document.body.innerText.includes('Set a quick PIN')", timeout=timeout)
    if "Set a quick PIN" in pg.inner_text("body"):
        pg.click("text=Skip for now")
        pg.wait_for_url("http://localhost:3100/", timeout=timeout)

def latest_code():
    f=sorted(glob.glob("/tmp/mails/*.eml"))[-1]; return re.match(r"(\d{6})", email.message_from_bytes(open(f,'rb').read())["Subject"]).group(1)
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
def login(pg, addr):
    pg.goto("http://localhost:3100/login"); pg.fill("input[type=email]", addr); pg.click("text=Send code")
    pg.wait_for_selector("text=Enter your code"); time.sleep(0.3); pg.keyboard.type(latest_code()); skip_pin(pg); pg.wait_for_load_state("networkidle")
def session_cookie(ctx): return [c["value"] for c in ctx.cookies() if c["name"]=="dops_session"]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    # A: stale/garbage cookie (e.g. old session after DB reset) -> must land on login, not loop
    ctx=b.new_context(); pg=ctx.new_page(); navs=[]
    pg.on("framenavigated", lambda f: navs.append(f.url) if f==pg.main_frame else None)
    ctx.add_cookies([{"name":"dops_session","value":"stale-token-from-old-deploy","url":"http://localhost:3100"}])
    pg.goto("http://localhost:3100/"); pg.wait_for_url("**/login?expired=1", timeout=10000); time.sleep(4)
    ok(pg.url.endswith("/login?expired=1") and len(navs)<=4, f"A stale cookie -> {pg.url} after {len(navs)} navigations, then stable 4s (no loop)")
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
