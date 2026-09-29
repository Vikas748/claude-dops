import json, urllib.request, glob, email, re, subprocess, time, hashlib
exec(open('/tmp/flow.py').read().split("ok=lambda")[0])
R={"pass":0,"fail":0}
def ok(c,msg):
    R["pass" if c else "fail"]+=1; print(("PASS " if c else "FAIL ")+msg)
def fresh(): sql("update auth_otps set created_at=created_at - interval '3 hours'")
def web_login(addr):
    fresh(); call("POST","/api/auth/request-otp",{"email":addr}); code,_=last_code()
    c,d,sc=call("POST","/api/auth/verify-otp",{"email":addr,"code":code}); return web_cookie(sc)
def raw(method,url,data=None,headers=None,follow=True):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k): return None
    opener=urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    r=urllib.request.Request(url,data=data,headers=headers or {},method=method)
    try: resp=opener.open(r); return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e: return e.code, e.read(), e.headers
def upload(cookie, path, ctype, ctx, declared=None):
    data=open(path,"rb").read()
    c,d,_=call("POST","/api/uploads",{**ctx,"fileName":path.split("/")[-1],"contentType":ctype,"size":declared or len(data)},cookie=cookie)
    if c!=200: return None,(c,d.get("message"))
    pc,pb,_=raw("PUT",d["data"]["uploadUrl"],data,{"content-type":ctype})
    return d["data"]["uploadId"],(pc,pb[:80])
def objects(): return json.loads(urllib.request.urlopen("http://127.0.0.1:9100/_debug/objects").read())
F="/tmp/files/"

# ---------- setup ----------
admin=web_login("head.dept@hospital.in")
call("POST","/api/admin",{"name":"Nurse Ward","email":"nurse@hospital.in","role":"NURSE","status":"ACTIVE","permissions":["WARD:VIEW","WARD:EDIT"]},cookie=admin)
call("POST","/api/admin",{"name":"Dr OT","email":"dr.ot@hospital.in","role":"DOCTOR","status":"ACTIVE","permissions":["OT:VIEW","OT:CREATE","CLASS:VIEW","CLASS:CREATE"]},cookie=admin)
stamp=str(int(time.time()))[-6:]
c,d,_=call("POST","/api/patients",{"name":f"Upload Test {stamp}","age":35,"sex":"Male","mobile":"98765"+stamp[-5:],"address":"Jabalpur","diagnosis":"Post-burn contracture"},cookie=admin)
_,pl,_=call("GET",f"/api/patients?q=Upload%20Test%20{stamp}",cookie=admin); opd=pl["data"][0]["opdId"]
c,d,_=call("POST",f"/api/opd/{opd}/admit",{},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin); ipd=[i for i in cl["data"]["ipd"] if i["name"]==f"Upload Test {stamp}"][0]["id"]
call("POST","/api/clinical",{"action":"move_ward","id":ipd,"wardName":"Burns A","bedNumber":"12"},cookie=admin)
call("POST","/api/clinical",{"action":"schedule_ot","id":ipd,"scheduledDate":"2026-09-28","scheduledTime":"10:00","procedureName":"Release + graft","surgeonName":"Dr X"},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin)
ot=[o for o in cl["data"]["ot"] if o["ipdId"]==ipd][0]["id"]; ward=[w for w in cl["data"]["ward"] if w["ipdId"]==ipd and not w["dischargedAt"]][0]["wardId"]
print(f"setup: patient opd={opd} ipd={ipd} ward={ward} ot={ot}")

# ---------- academic ----------
uid,(pc,_)=upload(admin,F+"lecture.pdf","application/pdf",{"purpose":"ACADEMIC","kind":"CLASS"})
c,d,_=call("POST","/api/academic",{"kind":"CLASS","title":f"Flap basics {stamp}","doctorName":"Dr A","documentDate":"2026-09-27","uploadId":uid},cookie=admin)
ok(pc==200 and c==201, f"U1 academic PDF: direct PUT {pc}, attach {c}")
_,lst,_=call("GET",f"/api/academic?kind=CLASS&q={stamp}",cookie=admin); key=lst["data"][0]["fileKey"]
s,b,h=raw("GET",B+"/api/files?key="+urllib.parse.quote(key),headers={"cookie":admin},follow=False)
loc=h.get("location",""); s2,b2,_=raw("GET",loc)
ok(s==302 and "127.0.0.1:9100" in loc and "token=" in loc and b2==open(F+"lecture.pdf","rb").read(),
   f"U2 /api/files -> {s} signed redirect, file bytes identical")
s,_,_=raw("GET",B+"/api/files?key="+urllib.parse.quote(key),follow=False); ok(s==401, f"U3 file link without login -> {s}")
c,d,_=call("POST","/api/academic",{"kind":"CLASS","title":"again","doctorName":"Dr A","documentDate":"2026-09-27","uploadId":uid},cookie=admin)
ok(c==400, f"U4 same uploadId reused -> {c}: {d['message']}")
before=set(objects())
uid,_=upload(admin,F+"fake.pdf","application/pdf",{"purpose":"ACADEMIC","kind":"CLASS"})
c,d,_=call("POST","/api/academic",{"kind":"CLASS","title":"fake","doctorName":"Dr A","documentDate":"2026-09-27","uploadId":uid},cookie=admin)
ok(c==400 and set(objects())==before, f"U5 text file named .pdf -> {c}: {d['message']} (deleted from storage)")
uid,(c,m)=upload(admin,F+"huge.pdf","application/pdf",{"purpose":"ACADEMIC","kind":"CLASS"})
ok(uid is None and c==400, f"U6 16 MB PDF declared honestly -> {c}: {m}")
uid,_=upload(admin,F+"huge.pdf","application/pdf",{"purpose":"ACADEMIC","kind":"CLASS"},declared=1000)
c,d,_=call("POST","/api/academic",{"kind":"CLASS","title":"liar","doctorName":"Dr A","documentDate":"2026-09-27","uploadId":uid},cookie=admin)
ok(c==400 and set(objects())==before, f"U7 16 MB PDF declared as 1 KB -> caught at attach {c}: {d['message']}")

# ---------- OT images ----------
ids=[upload(admin,F+f,t,{"purpose":"OT_IMAGE","otId":ot,"imageType":"PRE_OP"})[0] for f,t in [("big-photo.jpg","image/jpeg"),("card.png","image/png"),("photo.webp","image/webp")]]
c,d,_=call("POST","/api/ot-images",{"otId":ot,"imageType":"PRE_OP","uploadIds":ids},cookie=admin)
ok(c==201 and d["data"]["uploaded"]==3, f"U8 3 OT images incl. 6 MB photo (> Vercel 4.5 MB) -> {c}, uploaded {d.get('data')}")
_,imgs,_=call("GET",f"/api/ot-images?otId={ot}",cookie=admin)
sizes=sorted(i["sizeBytes"] for i in imgs["data"]); ok(sizes==sorted([6291460,73,1006]), f"U9 stored sizes are the real sizes {sizes}")
good,_=upload(admin,F+"card.png","image/png",{"purpose":"OT_IMAGE","otId":ot,"imageType":"POST_OP"})
bad,_=upload(admin,F+"fake.jpg","image/jpeg",{"purpose":"OT_IMAGE","otId":ot,"imageType":"POST_OP"})
c,d,_=call("POST","/api/ot-images",{"otId":ot,"imageType":"POST_OP","uploadIds":[good,bad]},cookie=admin)
st=sql(f"select claimed_at is null from upload_intents where id='{good}'")
ok(c==400 and st=="t", f"U10 one good + one fake image -> {c}: {d['message']}; good one released (unclaimed={st})")
c,d,_=call("POST","/api/ot-images",{"otId":ot,"imageType":"POST_OP","uploadIds":[good]},cookie=admin)
ok(c==201, f"U11 retry with only the good image -> {c}")
pre,_=upload(admin,F+"card.png","image/png",{"purpose":"OT_IMAGE","otId":ot,"imageType":"PRE_OP"})
c,d,_=call("POST","/api/ot-images",{"otId":ot,"imageType":"POST_OP","uploadIds":[pre]},cookie=admin)
ok(c==400, f"U12 PRE_OP upload attached as POST_OP -> {c}: {d['message']}")

# ---------- ownership / permission ----------
drot=web_login("dr.ot@hospital.in"); nurse=web_login("nurse@hospital.in")
theirs,_=upload(drot,F+"card.png","image/png",{"purpose":"OT_IMAGE","otId":ot,"imageType":"PRE_OP"})
c,d,_=call("POST","/api/ot-images",{"otId":ot,"imageType":"PRE_OP","uploadIds":[theirs]},cookie=admin)
ok(c==400, f"U13 admin tries to attach another user's upload -> {c}")
c,d,_=call("POST","/api/ot-images",{"otId":ot,"imageType":"PRE_OP","uploadIds":[theirs]},cookie=drot); ok(c==201, f"U14 owner attaches own upload -> {c}")
_,(c,m)=upload(nurse,F+"card.png","image/png",{"purpose":"OT_IMAGE","otId":ot,"imageType":"PRE_OP"}); ok(c==403, f"U15 nurse (no OT:CREATE) asks to upload OT image -> {c}")
_,(c,m)=upload(drot,F+"lecture.pdf","application/pdf",{"purpose":"ACADEMIC","kind":"RESEARCH"}); ok(c==403, f"U16 doctor with CLASS only uploads RESEARCH -> {c}")
c,d,_=call("POST","/api/uploads",{"purpose":"OT_IMAGE","otId":ot,"imageType":"PRE_OP","fileName":"x.exe","contentType":"application/x-msdownload","size":10},cookie=admin); ok(c==400, f"U17 .exe -> {c}: {d['message']}")
s,b,_=raw("PUT","http://127.0.0.1:9100/storage/v1/object/upload/sign/dops-private/patients/evil.jpg?token=forged",b"x",{"content-type":"image/jpeg"}); ok(s==400, f"U18 forged storage token -> {s}")

# ---------- discharge ----------
card,_=upload(nurse,F+"card.png","image/png",{"purpose":"DISCHARGE_CARD","wardId":ward})
c,d,_=call("POST","/api/clinical",{"action":"discharge","wardId":ward,"notes":"Stable, dressing on day 5","uploadId":card},cookie=nurse); ok(c==200, f"U19 nurse discharges with PNG card -> {c}")
ck=sql(f"select card_key||'|'||card_name from discharge_records where ipd_id={ipd}"); k,n=ck.split("|")
s,_,h=raw("GET",B+"/api/files?key="+urllib.parse.quote(k),headers={"cookie":nurse},follow=False); s2,b2,_=raw("GET",h.get("location",""))
ok(s==302 and b2==open(F+"card.png","rb").read() and n=="card.png", f"U20 discharge card viewable -> {s}, bytes match, name {n}")
c,d,_=call("POST","/api/clinical",{"action":"discharge","wardId":ward,"notes":"x"},cookie=nurse); ok(c==404, f"U21 discharging twice -> {c}")

print(f"\nTOTAL: {R['pass']} passed, {R['fail']} failed")
json.dump({"ot":ot,"ipd":ipd,"stamp":stamp},open("/tmp/up_ctx.json","w"))
