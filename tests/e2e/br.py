exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
ctx=json.load(open("/tmp/up_ctx.json")); ot=ctx["ot"]
admin=web_login("head.dept@hospital.in")
# B1 backup
c,d,_=call("POST","/api/admin/system",{"action":"backup"},cookie=admin)
s,b,_=raw("GET",d["data"]["url"]); snap=json.loads(b)
card=[f for f in snap["files"] if f["key"].startswith("discharge/")]
ok(c==200 and snap["format"]=="DOPS_RECOVERY_PACKAGE" and len(snap["files"])==d["data"]["fileCount"] and card and card[0]["contentType"]=="image/png",
   f"B1 backup -> {c}; package via signed URL ({len(b)} bytes), {len(snap['files'])} files, discharge card typed {card[0]['contentType'] if card else None}")
exp=sql("select count(*) from upload_intents where purpose='BACKUP_EXPORT' and claimed_at is null"); ok(int(exp)>=1, f"B2 export tracked for 1-hour auto-delete ({exp} pending)")
files={}
for f in snap["files"]:
    s,b,_=raw("GET",B+"/api/admin/system?file="+urllib.parse.quote(f["key"]),headers={"cookie":admin}); files[f["key"]]=b
ok(all(len(v)>0 for v in files.values()) and len(files)==len(snap["files"]), f"B3 all {len(files)} files downloadable through ?file= redirect")
# B4 change things after backup
call("POST","/api/patients",{"name":"Added After Backup","age":22,"sex":"Female","mobile":"9000000001","address":"x","diagnosis":"y"},cookie=admin)
_,imgs,_=call("GET",f"/api/ot-images?otId={ot}",cookie=admin); victim=imgs["data"][0]
call("DELETE",f"/api/ot-images?id={victim['id']}",cookie=admin)
gone=("dops-private/"+victim["fileKey"]) not in objects(); ok(gone, f"B4 after backup: new patient added, OT image deleted (file removed from storage: {gone})")
# B5 restore exactly as the browser does
for f in snap["files"]:
    c,d,_=call("POST","/api/admin/system",{"action":"restoreFileUrl","key":f["key"]},cookie=admin)
    s,_,_=raw("PUT",d["data"]["uploadUrl"],files[f["key"]],{"content-type":f["contentType"]}); assert s==200,(s,f)
pkg=json.dumps(snap).encode()
c,d,_=call("POST","/api/admin/system",{"action":"restorePackageUrl","size":len(pkg)},cookie=admin)
s,_,_=raw("PUT",d["data"]["uploadUrl"],pkg,{"content-type":"application/json"})
c,d,sc=call("POST","/api/admin/system",{"action":"restore","uploadId":d["data"]["uploadId"]},cookie=admin)
newc=[x for x in sc if x.startswith("dops_session=")]
unlock=[x.split(";")[0] for x in sc if x.startswith("dops_unlock=")]
ok(c==200 and newc and unlock, f"B5 restore ({len(snap['files'])} files, well over the old 6/min limit) -> {c}, admin re-issued session")
admin=newc[0].split(";")[0]+("; "+unlock[0] if unlock else "")
names=sql("select string_agg(name,',') from patients"); back=sql(f"select count(*) from ot_images where id={victim['id']} and deleted_at is null")
ok("Added After Backup" not in names and back=="1", f"B6 data rolled back: extra patient gone, deleted OT image record back ({back})")
s,b,h=raw("GET",B+"/api/files?key="+urllib.parse.quote(victim["fileKey"]),headers={"cookie":admin})
ok(s==200 and b==files[victim["fileKey"]], f"B7 deleted image file restored to storage, bytes identical ({len(b)} bytes)")
left=[k for k in objects() if k.startswith("dops-private/backups/restore/")]; ok(not left, f"B8 restore package removed from storage after use (left: {left})")
# B9 bad package
bad=json.dumps({"format":"SOMETHING_ELSE","data":{}}).encode()
c,d,_=call("POST","/api/admin/system",{"action":"restorePackageUrl","size":len(bad)},cookie=admin); raw("PUT",d["data"]["uploadUrl"],bad,{"content-type":"application/json"})
c,d,_=call("POST","/api/admin/system",{"action":"restore","uploadId":d["data"]["uploadId"]},cookie=admin)
left=[k for k in objects() if k.startswith("dops-private/backups/restore/")]
ok(c==400 and not left, f"B9 invalid package -> {c}: {d['message']} (also removed)")
# B10 non-admin
nurse=web_login("nurse@hospital.in"); c,_,_=call("POST","/api/admin/system",{"action":"backup"},cookie=nurse); ok(c==403, f"B10 nurse backup -> {c}")
c,d,_=call("POST","/api/admin/system",{"action":"restoreFileUrl","key":"../../etc/passwd"},cookie=admin); ok(c==400, f"B11 path traversal key -> {c}")
c,d,_=call("POST","/api/admin/system",{"action":"restoreFileUrl","key":"backups/exports/x.json"},cookie=admin); ok(c==400, f"B12 restore trying to overwrite backups/ -> {c}")
print(f"\nTOTAL: {R['pass']} passed, {R['fail']} failed")
