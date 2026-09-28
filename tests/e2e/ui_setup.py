exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
fresh(); call("POST","/api/auth/request-otp",{"email":"head.dept@hospital.in"}); code,_=last_code()
c,d,sc=call("POST","/api/auth/verify-otp",{"email":"head.dept@hospital.in","code":code}); admin=[x for x in sc if x.startswith("dops_session=")][0].split(";")[0]
call("POST","/api/patients",{"name":"Ramesh Kumar","age":35,"sex":"Male","mobile":"9876501234","address":"Jabalpur","diagnosis":"Post-burn contracture hand"},cookie=admin)
_,pl,_=call("GET","/api/patients?q=Ramesh",cookie=admin); call("POST",f"/api/opd/{pl['data'][0]['opdId']}/admit",{},cookie=admin)
_,cl,_=call("GET","/api/clinical",cookie=admin); ipd=cl["data"]["ipd"][0]["id"]
call("POST","/api/clinical",{"action":"move_ward","id":ipd,"wardName":"Burns A","bedNumber":"12"},cookie=admin)
print(call("POST","/api/clinical",{"action":"schedule_ot","id":ipd,"scheduledDate":time.strftime("%Y-%m-%d"),"scheduledTime":"10:00","procedureName":"Contracture release + SSG","surgeonName":"Dr Mehta"},cookie=admin)[:2])
print("ready ipd",ipd)
