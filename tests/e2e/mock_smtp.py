import ssl, time, itertools
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult
n=itertools.count(1)
class H:
    async def handle_DATA(self, s, sess, env):
        i=next(n); open(f'/tmp/mails/{i:03d}.eml','wb').write(env.content); open(f'/tmp/mails/{i:03d}.rcpt','w').write(','.join(env.rcpt_tos)); return '250 OK'
def auth(server, session, envelope, mechanism, data):
    return AuthResult(success=(data.login==b'test@dops.local' and data.password==b'abcdefghijklmnop'))
ctx=ssl.create_default_context(ssl.Purpose.CLIENT_AUTH); ctx.load_cert_chain('/tmp/c.pem','/tmp/k.pem')
c=Controller(H(),hostname='127.0.0.1',port=5871,tls_context=ctx,require_starttls=True,authenticator=auth,auth_require_tls=True); c.start()
print("up", flush=True)
while True: time.sleep(3600)
