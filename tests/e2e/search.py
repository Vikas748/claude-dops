exec(open('/tmp/up.py').read().split("# ---------- setup ----------")[0])
import urllib.parse as up
admin=web_login("head.dept@hospital.in")
pts=[("Ramesh Kumar","Post-burn contracture hand","9876500001"),("SUNITA DEVI","Cleft lip","9876500002"),("रमेश यादव","Burn scar neck","9876500003"),("Anil 50% Test","Hypospadias_repair","9876500004")]
for n,d,m in pts: call("POST","/api/patients",{"name":n,"age":30,"sex":"Male","mobile":m,"address":"Jabalpur","diagnosis":d},cookie=admin)
def names(q):
    _,d,_=call("GET","/api/patients?q="+up.quote(q),cookie=admin); return sorted(x["name"] for x in d["data"])
ok(names("ramesh")==["Ramesh Kumar"], f"S1 'ramesh' finds 'Ramesh Kumar' -> {names('ramesh')}")
ok(names("RAMESH")==["Ramesh Kumar"], f"S2 'RAMESH' (caps) -> {names('RAMESH')}")
ok(names("sunita")==["SUNITA DEVI"], f"S3 'sunita' finds all-caps 'SUNITA DEVI' -> {names('sunita')}")
ok(names("BURN")==sorted(["Ramesh Kumar","रमेश यादव"]), f"S4 diagnosis 'BURN' -> {names('BURN')}")
ok(names("रमेश")==["रमेश यादव"], f"S5 Hindi 'रमेश' -> {names('रमेश')}")
ok(names("50%")==["Anil 50% Test"], f"S6 '50%' treated literally (not wildcard) -> {names('50%')}")
ok(names("r_m")==[], f"S7 'r_m' does not wildcard-match 'Ramesh' -> {names('r_m')}")
ok(names("spadias_rep")==["Anil 50% Test"], f"S8 underscore matched literally -> {names('spadias_rep')}")
ok(names("00003")==["रमेश यादव"], f"S9 partial mobile -> {names('00003')}")
ok(len(names(""))==4, f"S10 empty search lists everyone ({len(names(''))})")
