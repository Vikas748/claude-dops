import os
# Client change request round 1: branding text, CM Helpline from Ward only, statuses, Leprosy summary, register switching
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
from playwright.sync_api import sync_playwright
admin=web_login("head.dept@hospital.in")
call("POST","/api/patients",{"name":"Helpline Patient","age":50,"sex":"Female","mobile":"9812345670","address":"Jabalpur","diagnosis":"Burn contracture"},cookie=admin)
_,pl,_=call("GET","/api/patients",cookie=admin); opd=pl["data"][0]["opdId"]; pid=pl["data"][0]["id"]
call("POST",f"/api/opd/{opd}/admit",{},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin); ipd=cl["data"]["ipd"][0]["id"]
call("POST","/api/clinical",{"action":"move_ward","id":ipd,"wardName":"Burns A","bedNumber":"7"},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin); ward=cl["data"]["ward"][0]["wardId"]
# ---- API rules ----
c,d,_=call("POST","/api/special",{"action":"link_helpline","patientId":pid,"source":"OPD"},cookie=admin); ok(c==400, f"H1 CM Helpline from OPD refused -> {c}: {d['message']}")
c,d,_=call("POST","/api/special",{"kind":"HELPLINE","recordDate":"2026-09-28","primaryName":"x","status":"PENDING","payload":{}},cookie=admin); ok(c==400, f"H2 manual CM Helpline case refused -> {c}: {d['message']}")
def nav(pg,x): pg.locator("[data-sidebar=menu-button]").filter(has_text=re.compile(f"^\\s*{x}\\s*$")).first.click(); time.sleep(1.2)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None); pg=b.new_page(viewport={"width":1366,"height":860})
    fresh(); pg.goto("http://localhost:3100/login"); to_email(pg); pg.fill("input[type=email]","head.dept@hospital.in"); pg.click("text=Send code"); pg.wait_for_selector("text=Enter your code"); time.sleep(0.3)
    pg.keyboard.type(last_code()[0]); skip_pin(pg); pg.wait_for_load_state("networkidle"); time.sleep(1)
    body=pg.inner_text("body")
    ok("PLASTIC & RECONSTRUCTIVE SURGERY" in body and "NSCB MEDICAL COLLEGE, JABALPUR" in body, "P2 header shows both lines in capitals")
    hdr=pg.evaluate("[...document.querySelectorAll('header span, header strong')].map(e=>e.tagName+':'+e.innerText).join(' | ')")
    ok(hdr.find("SPAN:PLASTIC & RECONSTRUCTIVE SURGERY")>=0 and hdr.find("STRONG:NSCB MEDICAL COLLEGE, JABALPUR")>=0, f"P2 swapped: department on top, college in bold ({hdr[:120]})")
    ok("Plastic & Reconstructive Surgery" in pg.inner_text("[data-sidebar=sidebar]") and "Burn & Plastic Surgery" not in body, "P1 sidebar subtitle is 'Plastic & Reconstructive Surgery'")
    pg.screenshot(path="/tmp/shots/s1-header.png", clip={"x":0,"y":0,"width":1366,"height":120})
    nav(pg,"OPD"); ok(pg.locator("[aria-label*='CM Helpline']").count()==0, "P3 OPD rows have no CM Helpline button")
    nav(pg,"IPD"); ok(pg.locator("table button", has_text="CM Helpline").count()==0, "P4 IPD rows have no CM Helpline button")
    nav(pg,"Ward"); btn=pg.locator("table button", has_text="CM Helpline"); ok(btn.count()==1, "P5 Ward row has a CM Helpline button next to Discharge")
    pg.screenshot(path="/tmp/shots/s1-ward.png")
    btn.first.click(); time.sleep(1.5)
    rec=sql("select payload from special_records where kind='HELPLINE'"); ok('"Ward / Bed":"Burns A / 7"' in rec and '"Patient ID":"DOPS-' in rec, f"P5 case created from Ward with Patient ID and Ward/Bed")
    btn.first.click(); time.sleep(1.2); ok("already has an active CM Helpline case" in pg.inner_text("body"), "P5 second click is refused (no duplicate case)")
    nav(pg,"Leprosy"); time.sleep(0.5)
    cards=pg.inner_text("[aria-label='Leprosy monthly summary']")
    ok("Total records" in cards and "Release pending" in cards and "released value" not in cards.lower() and "Amount released" not in cards, f"P8 Leprosy summary: {cards.replace(chr(10),' / ')}")
    nav(pg,"CM Helpline"); heads=pg.inner_text("table thead")
    ok("WARD / BED" in heads.upper() and "AADHAAR" not in heads.upper(), f"P9 CM Helpline shows its own table after visiting Leprosy (headers: {heads.replace(chr(10),' | ')[:120]})")
    opts=pg.eval_on_selector("select[aria-label='CM Helpline status']","s=>[...s.options].map(o=>o.text)"); ok(opts==["All statuses","Pending","Resolved"], f"P10 status filter options {opts}")
    ok(pg.locator("button", has_text=re.compile("Add Row|Link Patient")).count()==0, "P9 no manual add on CM Helpline page")
    pg.screenshot(path="/tmp/shots/s1-helpline.png")
    time.sleep(5)  # let the earlier notification disappear
    pg.click("button[aria-label='Edit Helpline Patient']"); time.sleep(0.6)
    so=pg.eval_on_selector("[role=dialog] select[name=status]","s=>[...s.options].map(o=>o.text)"); ok(so==["Pending","Resolved"], f"P10 edit status options {so}")
    pg.select_option("[role=dialog] select[name=status]","RESOLVED"); pg.fill("[role=dialog] [name=Description]","Called family, resolved"); pg.locator("[role=dialog] button", has_text="Save Row").click(); time.sleep(1.5)
    st=sql("select status from special_records where kind='HELPLINE'"); rec=sql("select payload from special_records where kind='HELPLINE'")
    ok(st=="RESOLVED" and '"Ward / Bed":"Burns A / 7"' in rec and "Called family" in rec and '"Resolved At":"20' in rec, "P10 case resolved from the edit form; Ward/Bed kept, resolved time recorded")
    b.close()
print(f"TOTAL: {R['pass']} passed, {R['fail']} failed")
