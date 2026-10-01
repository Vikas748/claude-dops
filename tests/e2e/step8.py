import os
# Ward/OT round: Ward ADMIT/DISCHARGED tabs, Schedule OT column, PAC dropdown + feedback, OT date/time order, bigger PAC, no Postpone
exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
from playwright.sync_api import sync_playwright
import datetime
admin=web_login("head.dept@hospital.in")
TOMORROW=(datetime.datetime.utcnow()+datetime.timedelta(hours=5,minutes=30,days=1)).strftime("%Y-%m-%d")
for n,m in [("Ward Active","9811100081"),("Ward Left","9811100082")]:
    call("POST","/api/patients",{"name":n,"age":40,"sex":"Male","mobile":m,"address":"J","diagnosis":"Burn","opdNumber":"W-"+m[-2:]},cookie=admin)
_,pl,_=call("GET","/api/patients",cookie=admin)
for p_ in pl["data"]: call("POST",f"/api/opd/{p_['opdId']}/admit",{},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin)
for i in cl["data"]["ipd"]: call("POST","/api/clinical",{"action":"move_ward","id":i["id"],"wardName":"Burns","bedNumber":"2"},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin); wd={x["name"]:x for x in cl["data"]["ward"]}
call("POST","/api/clinical",{"action":"discharge","wardId":wd["Ward Left"]["wardId"],"notes":"x","status":"LAMA"},cookie=admin)
ipd_active=[x["id"] for x in cl["data"]["ipd"] if x["name"]=="Ward Active"][0]
call("POST","/api/clinical",{"action":"schedule_ot","id":ipd_active,"scheduledDate":TOMORROW,"scheduledTime":"09:30","procedureName":"Split skin graft","surgeonName":"Dr Rao"},cookie=admin)
def nav(pg,x): pg.locator("[data-sidebar=menu-button]").filter(has_text=re.compile(rf"^\s*{x}\s*$",re.I)).first.click(); time.sleep(1.3)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None); pg=b.new_page(viewport={"width":1440,"height":900})
    fresh(); pg.goto("http://localhost:3100/login"); pg.wait_for_selector("text=Send code"); pg.fill("input[type=email]","head.dept@hospital.in"); pg.click("text=Send code")
    pg.wait_for_selector("text=Enter your code"); time.sleep(0.3); pg.keyboard.type(last_code()[0])
    pg.wait_for_function("location.pathname === '/' || document.body.innerText.includes('Set your PIN')",timeout=15000)
    if "Set your PIN" in pg.inner_text("body"):
        pg.locator("#pin-new").focus(); pg.keyboard.type("2580"); pg.locator("#pin-confirm").focus(); pg.keyboard.type("2580"); pg.click("button:has-text('Save PIN')")
    pg.wait_for_url("http://localhost:3100/",timeout=15000); time.sleep(1.5)
    nav(pg,"IPD"); ok(pg.locator("table button:has-text('Schedule OT')").count()==0 and pg.locator("table button:has-text('Plan')").count()>=1, "I1 IPD has no Schedule OT button")
    nav(pg,"Ward")
    tabs=pg.evaluate("[...document.querySelectorAll('.ward-tab')].map(t=>[t.innerText.trim(), t.dataset.state])")
    ok(tabs==[["ADMIT PATIENT (1)","active"],["DISCHARGED PATIENT (1)","inactive"]], f"T1 Ward tabs with counts, ADMIT PATIENT first {tabs}")
    heads=pg.evaluate("[...document.querySelectorAll('table thead th')].map(t=>t.innerText.trim().toUpperCase())")
    ok("SCHEDULE OT" in heads and "STATUS" not in heads and "Ward Left" not in pg.inner_text("table"), f"T2 ADMIT PATIENT: Schedule OT column instead of STATUS {heads}")
    ok(pg.inner_text(".module-count").split()[0]=="1", "T3 header count follows the open tab")
    row=pg.locator("tr", has_text="Ward Active"); cells=row.locator("td")
    ok("Schedule OT" in cells.nth(6).inner_text() and "Schedule OT" not in cells.nth(7).inner_text() and "Discharge" in cells.nth(7).inner_text(), "T4 Schedule OT button sits in its own column; Actions keep Discharge + CM Helpline")
    cells.nth(6).locator("button").click(); time.sleep(0.5); ok(pg.locator("[role=dialog]").count()==1 and "OT" in pg.inner_text("[role=dialog]"), "T5 Schedule OT works as before"); pg.keyboard.press("Escape"); time.sleep(0.4)
    pg.select_option("select[aria-label='PAC fitness for Ward Active']","FIT"); time.sleep(1.5)
    ok(sql(f"select pac_status from ward_stays where id={wd['Ward Active']['wardId']}")=="FIT" and "PAC updated: FIT" in pg.inner_text("body"), "P1 PAC dropdown saves and confirms 'PAC updated: FIT'")
    pg.screenshot(path="/tmp/shots/s8-ward-admit.png")
    pg.click(".ward-tab-discharged"); time.sleep(0.6)
    heads=pg.evaluate("[...document.querySelectorAll('table thead th')].map(t=>t.innerText.trim().toUpperCase())")
    ok("STATUS" in heads and "SCHEDULE OT" not in heads and pg.locator("select[aria-label='Status for Ward Left']").input_value()=="LAMA", "D1 DISCHARGED PATIENT tab: STATUS dropdown as before")
    ok(pg.locator("select[aria-label='PAC fitness for Ward Left']").count()==0 and pg.locator("tr", has_text="Ward Left").locator(".clinical-badge").count()>=1, "D2 PAC shown as a badge (not a disabled dropdown) for discharged patients")
    ok(pg.locator("tr", has_text="Ward Left").locator("button:has-text('Discharge')").count()==0, "D3 no Discharge button for discharged patients")
    pg.screenshot(path="/tmp/shots/s8-ward-left.png")
    nav(pg,"OT"); pg.locator("[role=tab]", has_text=re.compile("Tomorrow",re.I)).first.click(); time.sleep(0.8)
    heads=pg.evaluate("[...document.querySelectorAll('table thead th')].map(t=>t.innerText.trim().toUpperCase())")
    first=pg.locator("tr", has_text="Ward Active").locator("td").first
    ok(heads[0]=="DATE / TIME" and re.match(r"^\d{2}-\d{2}-\d{4}$", first.locator("strong").inner_text()) and first.locator("small").inner_text()=="09:30", f"O1 OT: date on top, time below ({heads[0]})")
    ok(pg.locator("button:has-text('Postpone')").count()==0 and pg.locator("button[aria-label='Mark completed']").count()>=1, "O2 Postpone removed; Mark completed kept")
    fs=pg.evaluate("getComputedStyle(document.querySelector('.pac-big .clinical-badge')).fontSize"); ok(fs=="13px", f"O3 bigger PAC badge ({fs})")
    pg.screenshot(path="/tmp/shots/s8-ot.png")
    b.close()
print(f"TOTAL: {R['pass']} passed, {R['fail']} failed")
