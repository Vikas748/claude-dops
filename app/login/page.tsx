"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, KeyRound, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

type Step = "email" | "code" | "request" | "requested" | "pin" | "setpin";
type PinDevice = { name: string; email: string } | null;
type Notice = { text: string; tone: "info" | "error" } | null;

async function postJson(url: string, body: unknown) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "No internet connection. Check your network and try again." } };
  }
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [cooldown, setCooldown] = useState(0);
  const verifying = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const pinInput = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinDevice, setPinDevice] = useState<PinDevice>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Does this browser have a PIN? Then offer "Welcome back — enter your PIN".
  useEffect(() => {
    fetch("/api/auth/pin", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.data?.enabled) {
          setPinDevice({ name: j.data.name, email: j.data.email });
          setStep((current) => (current === "email" ? "pin" : current));
        } else if (j?.data?.locked) {
          setNotice({ text: "Your PIN is locked after too many attempts. Sign in with your email code to set a new one.", tone: "info" });
        }
      })
      .catch(() => {});
  }, []);

  // Arrived here because a session ended (expired, signed out elsewhere, or access changed).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("expired"))
      queueMicrotask(() => setNotice({ text: "Your session has ended. Sign in again to continue.", tone: "info" }));
  }, []);

  // The code box is disabled while a request runs, which drops focus. Once it is
  // enabled again (after a wrong code or "Resend code"), put the cursor back in it.
  useEffect(() => {
    if (step === "code" && !busy) codeInput.current?.focus();
    if ((step === "pin" || step === "setpin") && !busy) pinInput.current?.focus();
  }, [step, busy]);

  async function requestCode() {
    setBusy(true);
    setNotice(null);
    const result = await postJson("/api/auth/request-otp", { email });
    setBusy(false);
    const retryAfter = Number(result.data.retryAfter ?? result.data.resendAfter ?? 0);
    if (retryAfter > 0) setCooldown(retryAfter);
    if (!result.ok) {
      setNotice({ text: String(result.data.message ?? "The code could not be sent. Try again."), tone: "error" });
      return;
    }
    setCode("");
    setStep("code");
    setNotice({ text: `If ${email} is registered, a 6-digit code is on its way. Check spam if it is not in your inbox.`, tone: "info" });
  }

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (!busy) void requestCode();
  }

  async function verify(value: string) {
    if (verifying.current || value.length !== 6) return;
    verifying.current = true;
    setBusy(true);
    setNotice(null);
    const result = await postJson("/api/auth/verify-otp", { email, code: value });
    if (result.ok) {
      if (result.data.offerPin) {
        verifying.current = false;
        setBusy(false);
        setNotice(null);
        setPin("");
        setPinConfirm("");
        setStep("setpin");
        return;
      }
      setNotice({ text: "Signed in. Opening DOPS…", tone: "info" });
      // Full navigation so the new session cookie is used everywhere.
      window.location.replace("/");
      return;
    }
    verifying.current = false;
    setBusy(false);
    setCode("");
    setNotice({ text: String(result.data.message ?? "Sign-in failed. Try again."), tone: "error" });
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void verify(code);
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setNotice(null);
  }

  async function pinLogin(value: string) {
    if (busy || value.length !== 4) return;
    setBusy(true);
    setNotice(null);
    const result = await postJson("/api/auth/pin", { action: "login", pin: value });
    if (result.ok) {
      setNotice({ text: "Signed in. Opening DOPS…", tone: "info" });
      window.location.replace("/");
      return;
    }
    setBusy(false);
    setPin("");
    setNotice({ text: String(result.data.message ?? "Sign-in failed. Try again."), tone: "error" });
    if (result.status === 423 || result.status === 403) {
      setPinDevice(null);
      setStep("email");
    }
  }

  async function savePin(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (pin.length !== 4 || pinConfirm.length !== 4) return setNotice({ text: "Enter the 4-digit PIN twice.", tone: "error" });
    setBusy(true);
    setNotice(null);
    const result = await postJson("/api/auth/pin", { action: "setup", pin, confirm: pinConfirm });
    if (result.ok) {
      setNotice({ text: "PIN saved. Opening DOPS…", tone: "info" });
      window.location.replace("/");
      return;
    }
    setBusy(false);
    setNotice({ text: String(result.data.message ?? "Could not save the PIN."), tone: "error" });
  }

  function switchToEmail() {
    setPin("");
    setNotice(null);
    setStep("email");
  }

  async function forgetThisDevice() {
    await fetch("/api/auth/pin", { method: "DELETE" }).catch(() => {});
    setPinDevice(null);
    switchToEmail();
  }

  function openRequest() {
    setStep("request");
    setNotice(null);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice(null);
    const result = await postJson("/api/auth/request-account", {
      name: form.get("name"),
      email: form.get("email"),
      mobile: form.get("mobile"),
      role: form.get("role"),
      note: form.get("note"),
      website: form.get("website"), // hidden anti-spam field
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ text: String(result.data.message ?? "Could not send the request. Try again."), tone: "error" });
      return;
    }
    setEmail(String(form.get("email") ?? ""));
    setStep("requested");
  }

  const heading =
    step === "code" ? "Enter your code" : step === "request" ? "Request an account" : step === "requested" ? "Request sent"
    : step === "pin" ? `Welcome back${pinDevice ? `, ${pinDevice.name}` : ""}` : step === "setpin" ? "Set a quick PIN" : "Sign in";

  return <main className="login-shell">
    <aside className="login-hero" aria-label="DOPS">
      <div className="login-hero-art" aria-hidden="true" />
      <div className="login-hero-top">
        <Image src="/brand/dops-logo-full.png" alt="DOPS — Plastic & Reconstructive Surgery" width={529} height={600} priority unoptimized className="login-logo" />
      </div>
      <div className="login-hero-copy">
        <h2>Plastic &amp; Reconstructive Surgery Department Management</h2>
        <p>OPD → IPD → Ward → OT → Discharge. Academics, Skin Bank, Leprosy &amp; CM Helpline — one continuous patient record.</p>
      </div>
      <p className="login-hero-foot">NSCB MEDICAL COLLEGE, JABALPUR</p>
    </aside>

    <section className="login-panel">
      <div className="login-card auth-card">
        <p className="login-eyebrow">{step === "request" || step === "requested" ? "NEW USER" : "SECURE ACCESS"}</p>
        <h1>{heading}</h1>

        {step === "pin" && <>
          <p className="login-sub">Enter your 4-digit PIN for <strong>{pinDevice?.email}</strong>.</p>
          <form onSubmit={(event) => { event.preventDefault(); void pinLogin(pin); }}>
            <label htmlFor="pin-code">PIN</label>
            <InputOTP id="pin-code" ref={pinInput} maxLength={4} value={pin} onChange={(v) => setPin(v.replace(/\D/g, ""))} onComplete={(v: string) => void pinLogin(v)}
              pattern="^[0-9]*$" inputMode="numeric" disabled={busy} containerClassName="auth-otp" autoFocus>
              <InputOTPGroup>{[0, 1, 2, 3].map((i) => <InputOTPSlot key={i} index={i} className="auth-otp-slot pin-slot" aria-invalid={notice?.tone === "error" || undefined} />)}</InputOTPGroup>
            </InputOTP>
            {notice && <div className={`auth-message${notice.tone === "error" ? " is-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
            <Button className="login-primary" disabled={busy || pin.length !== 4}><KeyRound /> {busy ? "Signing in…" : "Sign in with PIN"}</Button>
          </form>
          <p className="login-switch"><button type="button" onClick={switchToEmail}>Forgot PIN? Use email code</button></p>
          <p className="login-switch login-switch-small">Not you? <button type="button" onClick={() => void forgetThisDevice()}>Remove PIN from this device</button></p>
        </>}

        {step === "setpin" && <>
          <p className="login-sub">Next time on <strong>this device</strong>, sign in with a 4-digit PIN instead of an email code. Skip this on a shared computer.</p>
          <form onSubmit={savePin}>
            <label htmlFor="pin-new">New PIN</label>
            <InputOTP id="pin-new" ref={pinInput} maxLength={4} value={pin} onChange={(v) => setPin(v.replace(/\D/g, ""))} pattern="^[0-9]*$" inputMode="numeric" disabled={busy} containerClassName="auth-otp">
              <InputOTPGroup>{[0, 1, 2, 3].map((i) => <InputOTPSlot key={i} index={i} className="auth-otp-slot pin-slot" />)}</InputOTPGroup>
            </InputOTP>
            <label htmlFor="pin-confirm">Confirm PIN</label>
            <InputOTP id="pin-confirm" maxLength={4} value={pinConfirm} onChange={(v) => setPinConfirm(v.replace(/\D/g, ""))} pattern="^[0-9]*$" inputMode="numeric" disabled={busy} containerClassName="auth-otp">
              <InputOTPGroup>{[0, 1, 2, 3].map((i) => <InputOTPSlot key={i} index={i} className="auth-otp-slot pin-slot" />)}</InputOTPGroup>
            </InputOTP>
            {notice && <div className={`auth-message${notice.tone === "error" ? " is-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
            <Button className="login-primary" disabled={busy || pin.length !== 4 || pinConfirm.length !== 4}><KeyRound /> {busy ? "Saving…" : "Save PIN"}</Button>
          </form>
          <p className="login-switch"><button type="button" onClick={() => window.location.replace("/")}>Skip for now</button></p>
        </>}

        {step === "email" && <>
          <p className="login-sub">Sign in with a one-time code sent to your email.</p>
          <form onSubmit={submitEmail}>
            <label>Email address<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="you@hospital.in" required autoFocus /></label>
            {notice && <div className={`auth-message${notice.tone === "error" ? " is-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
            <Button className="login-primary" disabled={busy || !email}><Mail /> {busy ? "Sending code…" : "Send code"}</Button>
          </form>
          <p className="login-switch">New user? <button type="button" onClick={openRequest}>Request an account</button></p>
        </>}

        {step === "code" && <>
          <p className="login-sub">Enter the 6-digit code sent to <strong>{email}</strong>. It expires in 10 minutes.</p>
          <form onSubmit={submitCode}>
            <label htmlFor="otp-code">Sign-in code</label>
            <InputOTP
              id="otp-code"
              ref={codeInput}
              maxLength={6}
              value={code}
              onChange={(value) => setCode(value.replace(/\D/g, ""))}
              onComplete={(value: string) => void verify(value)}
              pattern="^[0-9]*$"
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy}
              autoFocus
              containerClassName="auth-otp"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot key={index} index={index} className="auth-otp-slot" aria-invalid={notice?.tone === "error" || undefined} />)}
              </InputOTPGroup>
            </InputOTP>
            {notice && <div className={`auth-message${notice.tone === "error" ? " is-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
            <Button className="login-primary" disabled={busy || code.length !== 6}><ShieldCheck /> {busy ? "Signing in…" : "Sign in"}</Button>
            <div className="auth-actions">
              <Button type="button" variant="ghost" onClick={changeEmail} disabled={busy}>Change email</Button>
              <Button type="button" variant="ghost" onClick={() => void requestCode()} disabled={busy || cooldown > 0}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </Button>
            </div>
          </form>
        </>}

        {step === "request" && <>
          <p className="login-sub">Fill in your details. The department administrator will approve your access.</p>
          <form onSubmit={submitRequest} className="login-request">
            <label>Full name<Input name="name" autoComplete="name" required minLength={2} maxLength={100} autoFocus /></label>
            <label>Email address<Input name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@hospital.in" required /></label>
            <div className="login-row">
              <label>Mobile number<Input name="mobile" inputMode="numeric" autoComplete="tel-national" pattern="[0-9]{10}" maxLength={10} placeholder="10 digits" required /></label>
              <label>Role
                <select name="role" required defaultValue="">
                  <option value="" disabled>Select</option>
                  <option value="DOCTOR">Doctor</option>
                  <option value="RESIDENT">Resident</option>
                  <option value="NURSE">Nurse</option>
                  <option value="STAFF">Staff</option>
                </select>
              </label>
            </div>
            <label><span>Designation / note <span className="login-optional">(optional)</span></span><Input name="note" maxLength={300} placeholder="e.g. Senior Resident, Burns Unit" /></label>
            {/* Hidden from people; bots that fill every field are ignored. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="login-honeypot" aria-hidden="true" />
            {notice && <div className={`auth-message${notice.tone === "error" ? " is-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
            <Button className="login-primary" disabled={busy}><UserPlus /> {busy ? "Sending…" : "Send request"}</Button>
          </form>
          <p className="login-switch"><button type="button" onClick={changeEmail}><ArrowLeft /> Back to sign in</button></p>
        </>}

        {step === "requested" && <>
          <div className="login-success" role="status">
            <ShieldCheck />
            <p>Thank you. Your request has been sent to the department administrator. You will receive an email at <strong>{email}</strong> once your access is approved.</p>
          </div>
          <Button type="button" className="login-primary" onClick={changeEmail}>Back to sign in</Button>
        </>}

        <small className="auth-note">Protected department system. Never share your sign-in code.</small>
      </div>
    </section>
  </main>;
}
