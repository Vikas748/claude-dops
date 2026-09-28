"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

type Step = "email" | "code";
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Arrived here because a session ended (expired, signed out elsewhere, or access changed).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("expired"))
      queueMicrotask(() => setNotice({ text: "Your session has ended. Sign in again to continue.", tone: "info" }));
  }, []);

  // The code box is disabled while a request runs, which drops focus. Once it is
  // enabled again (after a wrong code or "Resend code"), put the cursor back in it.
  useEffect(() => {
    if (step === "code" && !busy) codeInput.current?.focus();
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

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><span>DOPS</span><small>Plastic &amp; Reconstructive Surgery</small></div>
      <div className="auth-icon">{step === "email" ? <Mail /> : <KeyRound />}</div>

      {step === "email" ? <>
        <h1>Sign in with email</h1>
        <p>Use the email address approved by the department administrator. We will send you a 6-digit sign-in code.</p>
        <form onSubmit={submitEmail}>
          <label>Email address<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required autoFocus /></label>
          {notice && <div className={`auth-message${notice.tone === "error" ? " is-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
          <Button disabled={busy || !email}>{busy ? "Sending code…" : "Send code"}</Button>
        </form>
      </> : <>
        <h1>Enter your code</h1>
        <p>Enter the 6-digit code sent to <strong>{email}</strong>. It expires in 10 minutes.</p>
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
          <Button disabled={busy || code.length !== 6}>{busy ? "Signing in…" : "Sign in"}</Button>
          <div className="auth-actions">
            <Button type="button" variant="ghost" onClick={changeEmail} disabled={busy}>Change email</Button>
            <Button type="button" variant="ghost" onClick={() => void requestCode()} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </Button>
          </div>
        </form>
      </>}

      <small className="auth-note">Only users added by the department administrator can sign in. Never share your sign-in code.</small>
    </section>
  </main>;
}
