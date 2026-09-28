exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
import email as em, glob, os
CRON={"authorization":"Bearer cron-secret-abcdef123456"}
def cron(path, hdr=CRON, cookie=None):
    h=dict(hdr); 
    if cookie: h["cookie"]=cookie
    s,b,_=raw("GET",B+path,headers=h); return s,json.loads(b)
def last_mail():
    f=sorted(glob.glob("/tmp/mails/*.eml"),key=os.path.getmtime)[-1]
    return em.message_from_bytes(open(f,'rb').read()), open(f.replace(".eml",".rcpt")).read().split(",")
admin=web_login("head.dept@hospital.in")
call("POST","/api/admin",{"name":"Dr OT","email":"dr.ot@hospital.in","role":"DOCTOR","status":"ACTIVE","permissions":["OT:VIEW"]},cookie=admin)
call("POST","/api/admin",{"name":"Clerk","email":"clerk@hospital.in","role":"STAFF","status":"ACTIVE","permissions":["OPD:VIEW"]},cookie=admin)
call("POST","/api/admin",{"name":"Admin Two","email":"admin2@hospital.in","role":"ADMIN","status":"ACTIVE","permissions":[]},cookie=admin)
for i,(n,d) in enumerate([("रमेश कुमार","Burn contracture"),("Sunita Devi","Cleft lip")]):
    call("POST","/api/patients",{"name":n,"age":30,"sex":"Male","mobile":f"98765000{i}9","address":"Jabalpur","diagnosis":d},cookie=admin)
_,pl,_=call("GET","/api/patients",cookie=admin)
for p in pl["data"]: call("POST",f"/api/opd/{p['opdId']}/admit",{},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin)
tomorrow=time.strftime("%Y-%m-%d",time.gmtime(time.time()+330*60+86400))
for k,i in enumerate(cl["data"]["ipd"]):
    call("POST","/api/clinical",{"action":"schedule_ot","id":i["id"],"scheduledDate":tomorrow,"scheduledTime":f"{9+k:02d}:00","procedureName":["Release + SSG","Cleft lip repair"][k],"surgeonName":"Dr Rao"},cookie=admin)
sql(f"update ot_procedures set pac_status='FIT' where id=(select min(id) from ot_procedures)")

s,_=cron("/api/cron/monthly-reports",hdr={}); ok(s==401, f"J1 no secret -> {s}")
s,_=cron("/api/cron/daily",hdr={"authorization":"Bearer wrong-secret-000000000"}); ok(s==401, f"J2 wrong secret -> {s}")
s,_=cron("/api/cron/daily",hdr={},cookie=web_login("clerk@hospital.in")); ok(s==401, f"J3 non-admin user -> {s}")
n0=len(glob.glob("/tmp/mails/*.eml"))
s,d=cron(f"/api/cron/monthly-reports?month={time.strftime('%Y-%m')}")
m,rc=last_mail(); pdfs=[p for p in m.walk() if p.get_content_type()=="application/pdf"]
ok(s==200 and len(pdfs)==2 and sorted(rc)==["admin2@hospital.in","head.dept@hospital.in"], f"J4 monthly report via cron secret -> {s}; 2 PDFs attached; to all active admins {sorted(rc)}")
for p in pdfs: open("/tmp/mail-"+p.get_filename(),"wb").write(p.get_payload(decode=True))
print("   subject:", m["Subject"], "| files:", [p.get_filename() for p in pdfs])
s,d=cron(f"/api/cron/monthly-reports?month={time.strftime('%Y-%m')}"); ok(s==200 and d["data"].get("skipped"), f"J5 duplicate cron call -> skipped: {d['data'].get('skipped')}")
s,d=cron(f"/api/cron/monthly-reports?month={time.strftime('%Y-%m')}&force=1"); ok(d["data"].get("skipped"), "J6 cron cannot force a resend")
s,d=cron(f"/api/cron/monthly-reports?month={time.strftime('%Y-%m')}&force=1",hdr={},cookie=admin); ok(s==200 and not d["data"].get("skipped"), f"J7 admin can force a resend -> {d['data'].get('detail')}")
s,d=cron("/api/cron/daily"); m,rc=last_mail()
body=[p for p in m.walk() if p.get_content_type()=="text/html"][0].get_payload(decode=True).decode()
ok(s==200 and "1 PAC pending" in m["Subject"] and sorted(rc)==sorted(["head.dept@hospital.in","admin2@hospital.in","dr.ot@hospital.in","test@dops.local"]) and "clerk" not in ",".join(rc),
   f"J8 daily OT reminder: '{m['Subject']}' -> {sorted(rc)} (clerk without OT access excluded)")
ok("dr.ot@hospital.in" not in (m["To"] or "")+(m["Cc"] or "") and m["Bcc"] is None, f"J9 staff addresses hidden (To: {m['To']}, no Bcc header)")
ok("रमेश कुमार" in body and "#fef2f2" in body, "J10 Hindi name in email, PAC-pending row highlighted")
ok("cleanup" in d["data"]["detail"], f"J11 housekeeping ran: {d['data']['detail'][-40:]}")
s,d=cron("/api/cron/daily"); ok(d["data"].get("skipped"), "J12 second daily call same day -> skipped")
c,d,_=call("POST","/api/clinical",{"action":"schedule_ot","id":cl["data"]["ipd"][0]["id"],"scheduledDate":tomorrow,"scheduledTime":"010:00","procedureName":"x","surgeonName":"y"},cookie=admin); ok(c==400, f"J13 malformed OT time rejected -> {c}: {d.get('message')}")
c,d,_=call("POST","/api/clinical",{"action":"schedule_ot","id":cl["data"]["ipd"][0]["id"],"scheduledDate":"2026-02-30","scheduledTime":"10:00","procedureName":"x","surgeonName":"y"},cookie=admin); ok(c==400, f"J14 impossible OT date rejected -> {c}: {d.get('message')}")
print("   audit:", sql("select string_agg(action,', ' order by id) from audit_logs where module='SYSTEM'"))
