"""Minimal Supabase Storage API mock (paths/shapes as used by @supabase/storage-js)."""
import json, secrets, time, os, re, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
KEY="test-service-key"; LIMIT=50*1024*1024; ROOT="/tmp/storage"
objects={}   # "bucket/path" -> (bytes, content_type)
tokens={}    # token -> ("bucket/path", upsert, exp, kind)
log=open("/tmp/storage.log","a")
class H(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","*")
        self.send_header("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS,HEAD"); self.send_header("Access-Control-Expose-Headers","*")
    def reply(self,code,body=b"",ctype="application/json",extra=None):
        if isinstance(body,(dict,list)): body=json.dumps(body).encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type",ctype); self.send_header("Content-Length",str(len(body)))
        for k,v in (extra or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(body)
    def body(self):
        n=int(self.headers.get("content-length") or 0); return self.rfile.read(n) if n else b""
    def authed(self): return self.headers.get("authorization")==f"Bearer {KEY}" and self.headers.get("apikey")==KEY
    def route(self):
        u=urllib.parse.urlparse(self.path); q=urllib.parse.parse_qs(u.query); p=urllib.parse.unquote(u.path)
        log.write(f"{self.command} {p}\n"); log.flush()
        return p,q
    def do_OPTIONS(self): self.reply(204)
    def notfound(self): self.reply(400,{"statusCode":"404","error":"not_found","message":"Object not found"})
    def serve(self,obj,q=None,range_hdr=None):
        data,ct=objects[obj]; extra={}
        if q and "download" in q: extra["Content-Disposition"]=f'attachment; filename="{q["download"][0] or obj.split("/")[-1]}"'
        m=re.match(r"bytes=(\d+)-(\d+)",range_hdr or "")
        if m:
            a,b=int(m[1]),min(int(m[2]),len(data)-1); extra["Content-Range"]=f"bytes {a}-{b}/{len(data)}"
            return self.reply(206,data[a:b+1],ct,extra)
        self.reply(200,data,ct,extra)
    def do_GET(self):
        p,q=self.route()
        m=re.match(r"^/storage/v1/object/sign/(.+)$",p)
        if m:
            t=tokens.get((q.get("token") or [""])[0])
            if not t or t[3]!="download" or t[0]!=m[1] or t[2]<time.time(): return self.reply(400,{"statusCode":"400","error":"InvalidJWT","message":"invalid signature"})
            return self.serve(m[1],q) if m[1] in objects else self.notfound()
        m=re.match(r"^/storage/v1/object/(?:authenticated/)?(.+)$",p)
        if m:
            if not self.authed(): return self.reply(400,{"statusCode":"403","error":"Unauthorized"})
            return self.serve(m[1],None,self.headers.get("range")) if m[1] in objects else self.notfound()
        self.reply(404,{"error":"route"})
    def do_POST(self):
        p,q=self.route(); raw=self.body()
        if not self.authed(): return self.reply(400,{"statusCode":"403","error":"Unauthorized"})
        m=re.match(r"^/storage/v1/object/upload/sign/(.+)$",p)
        if m:
            tok=secrets.token_urlsafe(24); tokens[tok]=(m[1],self.headers.get("x-upsert")=="true",time.time()+7200,"upload")
            return self.reply(200,{"url":f"/object/upload/sign/{urllib.parse.quote(m[1])}?token={tok}","token":tok})
        m=re.match(r"^/storage/v1/object/sign/(.+)$",p)
        if m:
            if m[1] not in objects: return self.notfound()
            exp=json.loads(raw or b"{}").get("expiresIn",60); tok=secrets.token_urlsafe(24); tokens[tok]=(m[1],False,time.time()+exp,"download")
            return self.reply(200,{"signedURL":f"/object/sign/{urllib.parse.quote(m[1])}?token={tok}"})
        m=re.match(r"^/storage/v1/object/(.+)$",p)
        if m:
            if m[1] in objects and self.headers.get("x-upsert")!="true": return self.reply(400,{"statusCode":"409","error":"Duplicate","message":"The resource already exists"})
            if len(raw)>LIMIT: return self.reply(413,{"statusCode":"413","error":"Payload too large"})
            objects[m[1]]=(raw,self.headers.get("content-type","application/octet-stream")); return self.reply(200,{"Key":m[1]})
        self.reply(404,{"error":"route"})
    def do_PUT(self):
        p,q=self.route(); m=re.match(r"^/storage/v1/object/upload/sign/(.+)$",p)
        if not m: return self.reply(404,{"error":"route"})
        t=tokens.get((q.get("token") or [""])[0])
        if not t or t[3]!="upload" or t[0]!=m[1] or t[2]<time.time(): self.body(); return self.reply(400,{"statusCode":"400","error":"InvalidJWT"})
        n=int(self.headers.get("content-length") or 0)
        if n>LIMIT: self.rfile.read(n); return self.reply(413,{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"})
        raw=self.body()
        if m[1] in objects and not t[1]: return self.reply(400,{"statusCode":"409","error":"Duplicate","message":"The resource already exists"})
        objects[m[1]]=(raw,self.headers.get("content-type","application/octet-stream")); self.reply(200,{"Key":m[1]})
    def do_DELETE(self):
        p,q=self.route(); m=re.match(r"^/storage/v1/object/(.+)$",p)
        if not self.authed(): return self.reply(400,{"statusCode":"403","error":"Unauthorized"})
        if m and m[1] in objects: del objects[m[1]]; return self.reply(200,{"message":"Successfully deleted"})
        self.notfound()
    def do_HEAD(self): self.reply(405)
# debug endpoint to list objects
orig_get=H.do_GET
def do_GET(self):
    if self.path=="/_debug/objects": return self.reply(200,{k:len(v[0]) for k,v in objects.items()})
    orig_get(self)
H.do_GET=do_GET
orig_post=H.do_POST
def do_POST(self):
    if self.path=="/_debug/reset":
        objects.clear(); tokens.clear(); self.body(); return self.reply(200,{"reset":True})
    orig_post(self)
H.do_POST=do_POST
ThreadingHTTPServer(("127.0.0.1",9100),H).serve_forever()
