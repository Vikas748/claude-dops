import os
import glob, email, re, time, json, zipfile, io, subprocess, urllib.request
from playwright.sync_api import sync_playwright
def skip_pin(pg, timeout=15000):
    """After the email code, DOPS offers to set a PIN; these tests choose "Skip for now"."""
    pg.wait_for_function("location.pathname === '/' || document.body.innerText.includes('Set a quick PIN')", timeout=timeout)
    if "Set a quick PIN" in pg.inner_text("body"):
        pg.click("text=Skip for now")
        pg.wait_for_url("http://localhost:3100/", timeout=timeout)

R={"p":0,"f":0}
def ok(c,m): R["p" if c else "f"]+=1; print(("PASS " if c else "FAIL ")+m)
def sql(q): return subprocess.run(["su","postgres","-c",f"psql -tAc \"{q}\""],capture_output=True,text=True).stdout.strip()
def latest_code():
    f=sorted(glob.glob("/tmp/mails/*.eml"),key=lambda p: __import__('os').path.getmtime(p))[-1]
    return re.match(r"(\d{6})", email.message_from_bytes(open(f,'rb').read())["Subject"]).group(1)
F="/tmp/files/"
def nav(pg,x): pg.locator("[data-sidebar=menu-button]").filter(has_text=re.compile(f"^\\s*{x}\\s*$")).first.click(); time.sleep(0.6)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    ctx=b.new_context(viewport={"width":1280,"height":860},accept_downloads=True); pg=ctx.new_page()
    errors=[]; pg.on("console", lambda m: errors.append(m.text) if m.type=="error" else None)
    sql("update auth_otps set created_at=created_at - interval '3 hours'")
    pg.goto("http://localhost:3100/login"); pg.fill("input[type=email]","head.dept@hospital.in"); pg.click("text=Send code")
    pg.wait_for_selector("text=Enter your code"); time.sleep(0.3); pg.keyboard.type(latest_code()); skip_pin(pg); pg.wait_for_load_state("networkidle")
    # --- Class PDF ---
    nav(pg,"Class"); pg.click("text=Add Class"); pg.fill("input[name=title]","Local flaps – basics"); pg.fill("input[name=doctorName]","Dr Mehta")
    pg.fill("input[name=documentDate]","2026-09-27"); pg.set_input_files("input[name=file]",F+"lecture.pdf"); pg.click("[role=dialog] button:has-text('Save')")
    pg.wait_for_selector("text=Local flaps – basics",timeout=15000); time.sleep(0.5)
    ok(sql("select count(*) from academic_documents")=="1", "UI1 Class: PDF uploaded through the form, listed in the table")
    pg.screenshot(path="/tmp/shots/u-1-class.png")
    with ctx.expect_page() as newp: pg.click("a[href*='/api/files']")
    doc=newp.value; doc.wait_for_load_state(); ok("127.0.0.1:9100/storage/v1/object/sign/" in doc.url, f"UI2 opening the PDF lands on a signed storage URL"); doc.close()
    # --- OT images ---
    nav(pg,"OT"); pg.wait_for_selector("text=Contracture release"); pg.click("button:has-text('Images')")
    pg.select_option("select[name=imageType]","POST_OP"); pg.set_input_files("input[name=images]",[F+"big-photo.jpg",F+"card.png"])
    pg.click("button:has-text('Upload images')")
    pg.wait_for_function("document.querySelectorAll('.ot-image-sections img').length>=2",timeout=30000); time.sleep(1)
    n=sql("select count(*) from ot_images where image_type='POST_OP'"); sz=sql("select max(size_bytes) from ot_images")
    loaded=pg.evaluate("[...document.querySelectorAll('.ot-image-sections img')].filter(i=>i.complete&&i.naturalWidth>0).length")
    ok(n=="2" and sz=="6291460", f"UI3 OT: 2 images (one 6 MB) uploaded from the form; largest stored {int(sz)//1024//1024} MB")
    ok(loaded>=1, f"UI4 real PNG renders in the gallery via signed redirect (loaded images: {loaded}; the 6 MB test 'photo' is random bytes, so it cannot render)")
    pg.screenshot(path="/tmp/shots/u-2-ot.png"); pg.keyboard.press("Escape"); time.sleep(0.5)
    # --- Discharge ---
    nav(pg,"Ward"); pg.wait_for_selector("text=Ramesh Kumar"); pg.click("button:has-text('Discharge')")
    pg.fill("textarea[name=notes]","Stable. Dressing on day 5."); pg.set_input_files("input[name=card]",F+"card.png"); pg.screenshot(path="/tmp/shots/u-3-discharge.png")
    pg.click("button:has-text('Confirm discharge')"); pg.wait_for_function("!document.querySelector('textarea[name=notes]')",timeout=15000); time.sleep(0.5)
    ok(sql("select card_name from discharge_records")=="card.png", "UI5 Ward: discharged with card uploaded from the form")
    # --- Backup ZIP ---
    nav(pg,"Admin"); pg.click("text=System Health"); pg.wait_for_selector("text=Download ZIP")
    with pg.expect_download(timeout=30000) as dl: pg.click("button:has-text('Download ZIP')")
    path=dl.value.path(); z=zipfile.ZipFile(path); names=z.namelist(); snap=json.loads(z.read("database.json"))
    ok("database.json" in names and len([n for n in names if n.startswith("files/") and not n.endswith("/")])==4 and len(z.read([n for n in names if n.endswith("big-photo.jpg")][0]))==6291460,
       f"UI6 Admin backup ZIP downloaded: database.json + {len([n for n in names if n.startswith('files/') and not n.endswith('/')])} files (6 MB photo intact)")
    zpath="/tmp/files/backup.zip"; open(zpath,"wb").write(open(path,"rb").read())
    # change data, then restore via UI
    sql("update patients set name='CHANGED NAME'")
    pg.set_input_files("input[accept='.zip,application/zip']",zpath); pg.wait_for_selector("text=Type",timeout=10000)
    pg.fill(".restore-confirm input","RESTORE DOPS"); pg.click("button:has-text('Review restore')")
    pg.screenshot(path="/tmp/shots/u-4-restore-confirm.png")
    pg.locator("[role=alertdialog] button").filter(has_text=re.compile("Restore",re.I)).last.click()
    pg.wait_for_function("document.body.innerText.includes('restored successfully')",timeout=40000)
    ok(sql("select name from patients")=="Ramesh Kumar", "UI7 Admin restore from ZIP through the UI: data back to backup point, admin still signed in")
    pg.screenshot(path="/tmp/shots/u-5-restored.png")
    bad=[e for e in errors if "401" not in e]; ok(not bad, f"UI8 no browser console errors ({bad[:2]})")
    b.close()
print(f"TOTAL {R['p']} passed, {R['f']} failed")
