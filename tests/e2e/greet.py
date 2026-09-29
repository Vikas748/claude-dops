import glob, email, re, time, os, subprocess, datetime
from playwright.sync_api import sync_playwright
def skip_pin(pg, timeout=15000):
    """After the email code, DOPS offers to set a PIN; these tests choose "Skip for now"."""
    pg.wait_for_function("location.pathname === '/' || document.body.innerText.includes('Set a quick PIN')", timeout=timeout)
    if "Set a quick PIN" in pg.inner_text("body"):
        pg.click("text=Skip for now")
        pg.wait_for_url("http://localhost:3100/", timeout=timeout)

def sql(q): return subprocess.run(["su","postgres","-c",f"psql -tAc \"{q}\""],capture_output=True,text=True).stdout.strip()
def code():
    f=sorted(glob.glob("/tmp/mails/*.eml"),key=os.path.getmtime)[-1]; return re.match(r"(\d{6})", email.message_from_bytes(open(f,'rb').read())["Subject"]).group(1)
def ok(c,m): print(("PASS " if c else "FAIL ")+m)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    for label, ist_time, expect in [("morning","08:15","Good morning"),("afternoon","14:00","Good afternoon"),("evening","21:40","Good evening")]:
        ctx=b.new_context(timezone_id="Asia/Kolkata"); pg=ctx.new_page(); errs=[]
        pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
        pg.clock.set_fixed_time(datetime.datetime.fromisoformat(f"2026-09-28T{ist_time}:00+05:30"))
        sql("update auth_otps set created_at=created_at - interval '3 hours'")
        pg.goto("http://localhost:3100/login"); pg.fill("input[type=email]","head.dept@hospital.in"); pg.click("text=Send code")
        pg.wait_for_selector("text=Enter your code"); time.sleep(0.3); pg.keyboard.type(code()); skip_pin(pg)
        pg.wait_for_function("document.querySelector('.welcome-row h1') && document.querySelector('.welcome-row h1').innerText.startsWith('Good')",timeout=15000)
        h=pg.inner_text(".welcome-row h1")
        hyd=[e for e in errs if "ydrat" in e or "418" in e or "425" in e]
        ok(h==f"{expect}, head.dept" and not hyd, f"G {label} ({ist_time} IST) -> '{h}' (hydration errors: {len(hyd)})")
        if label=="morning": pg.screenshot(path="/tmp/shots/greet.png")
        ctx.close()
    b.close()
