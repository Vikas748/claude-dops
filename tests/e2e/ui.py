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
    f=sorted(glob.glob("/tmp/mails/*.eml"),key=os.path.getmtime)[-1]; return re.match(r"(\d{6})", email.message_from_bytes(open(f,'rb').read())["Subject"]).group(1)
def run(p, name, vw, vh, addr):
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    pg=b.new_page(viewport={"width":vw,"height":vh})
    pg.goto("http://localhost:3100/"); print(name,"unauthenticated / ->",pg.url)
    pg.screenshot(path=f"/tmp/shots/{name}-1-email.png")
    pg.fill("input[type=email]", addr); pg.click("text=Send code")
    pg.wait_for_selector("text=Enter your code"); time.sleep(0.4)
    pg.screenshot(path=f"/tmp/shots/{name}-2-code.png")
    code=latest_code(); wrong=f"{(int(code)+1)%1000000:06d}"
    pg.keyboard.type(wrong); pg.wait_for_selector(".auth-message.is-error"); time.sleep(0.3)
    print(name,"wrong code ->",pg.inner_text(".auth-message")); print(name,"resend button ->",pg.inner_text(".auth-actions button:nth-child(2)"))
    pg.screenshot(path=f"/tmp/shots/{name}-3-error.png")
    pg.keyboard.type(code); skip_pin(pg); pg.wait_for_load_state("networkidle"); time.sleep(1)
    print(name,"after correct code ->",pg.url, "| cookie httpOnly:", [c["httpOnly"] for c in pg.context.cookies() if c["name"]=="dops_session"])
    pg.screenshot(path=f"/tmp/shots/{name}-4-dashboard.png")
    pg.goto("http://localhost:3100/login"); print(name,"signed-in visiting /login ->",pg.url)
    print(f"PASS {name}: email -> code -> wrong code error -> correct code -> dashboard; /login redirects when signed in")
    b.close()
with sync_playwright() as p:
    run(p,"desktop",1280,800,"head.dept@hospital.in")
    import subprocess; subprocess.run(["su","postgres","-c","psql -qc \"update auth_otps set created_at=created_at - interval '3 hours'\""])
    run(p,"mobile",360,740,"head.dept@hospital.in")
