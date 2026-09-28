/**
 * DOPS mailer — provider-agnostic SMTP via Nodemailer.
 *
 * Works with Gmail (App Password), Brevo, Resend SMTP, Amazon SES, etc.
 * Only environment variables change between providers:
 *
 *   SMTP_HOST     e.g. smtp.gmail.com | smtp-relay.brevo.com
 *   SMTP_PORT     465 (implicit TLS) or 587 (STARTTLS). Port 25 is blocked on Vercel.
 *   SMTP_USER     SMTP login
 *   SMTP_PASS     SMTP password / app password (never commit)
 *   MAIL_FROM     e.g. "DOPS <dops.department@gmail.com>"  (defaults to SMTP_USER)
 *
 * Server-only: never import this from a "use client" component.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

export class MailerConfigError extends Error {}

type MailerConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

function readConfig(): MailerConfig {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  // Gmail shows app passwords as "abcd efgh ijkl mnop" — strip the spaces.
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, "");
  const port = Number(process.env.SMTP_PORT ?? 465);
  const missing = [!host && "SMTP_HOST", !user && "SMTP_USER", !pass && "SMTP_PASS"].filter(Boolean);
  if (missing.length) throw new MailerConfigError(`Email is not configured: missing ${missing.join(", ")}.`);
  if (!Number.isInteger(port) || port <= 0) throw new MailerConfigError("SMTP_PORT must be a valid port number.");
  if (port === 25) throw new MailerConfigError("SMTP port 25 is blocked on Vercel. Use 465 or 587.");
  return {
    host: host!,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS upgrade
    user: user!,
    pass: pass!,
    from: process.env.MAIL_FROM?.trim() || `DOPS <${user}>`,
  };
}

/**
 * One transporter per warm serverless instance. No connection pool: a Vercel
 * function may freeze between requests, and a pooled socket would go stale.
 */
function transporter(): { transport: Transporter; from: string } {
  const cache = globalThis as typeof globalThis & { __dopsMailer?: { transport: Transporter; from: string; key: string } };
  const config = readConfig();
  const key = `${config.host}:${config.port}:${config.user}`;
  if (!cache.__dopsMailer || cache.__dopsMailer.key !== key) {
    cache.__dopsMailer = {
      key,
      from: config.from,
      transport: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure, // never send credentials unencrypted on 587
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cache.__dopsMailer;
}

/** Hide most of an address in logs: dr.sharma@gmail.com -> dr***@gmail.com */
export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export type SendMailInput = {
  to: string | string[];
  /** Hidden recipients — used for group mails so staff addresses are not shared. */
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Mail.Attachment[]; // used later for monthly PDF reports
};

/** Generic send. Throws on failure so callers decide how to respond. */
export async function sendMail(input: SendMailInput) {
  const { transport, from } = transporter();
  const info = await transport.sendMail({ from, ...input });
  const recipients = [...(Array.isArray(input.to) ? input.to : [input.to]), ...(input.bcc ?? [])].map(maskEmail).join(", ");
  console.info(`Mail sent to ${recipients} (${info.messageId})`);
  return { messageId: info.messageId };
}

/** Checks SMTP login without sending anything. Used by the health check. */
export async function verifyMailer() {
  try {
    await transporter().transport.verify();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "SMTP verification failed." };
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Builds the sign-in code email. Contains no patient data. Exported
 * separately from sendOtpEmail so it can be unit-tested without SMTP.
 */
export function buildOtpEmail(code: string, validMinutes: number, recipientName?: string | null) {
  if (!/^\d{6}$/.test(code)) throw new Error("OTP must be exactly 6 digits.");
  const greeting = recipientName?.trim() ? `Dear ${recipientName.trim()},` : "Hello,";
  const subject = `${code} is your DOPS sign-in code`;
  const text = [
    greeting,
    "",
    `Your DOPS sign-in code is: ${code}`,
    "",
    `This code is valid for ${validMinutes} minutes and can be used only once.`,
    "Do not share this code with anyone, including department staff.",
    "",
    "If you did not try to sign in, you can safely ignore this email.",
    "",
    "DOPS — Department of Burn & Plastic Surgery",
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0">
      <tr><td style="font-size:20px;font-weight:700;letter-spacing:1px">DOPS</td></tr>
      <tr><td style="font-size:13px;color:#6b7785;padding-bottom:24px">Department of Burn &amp; Plastic Surgery</td></tr>
      <tr><td style="font-size:15px;padding-bottom:16px">${escapeHtml(greeting)}</td></tr>
      <tr><td style="font-size:15px;padding-bottom:16px">Use this code to sign in to DOPS:</td></tr>
      <tr><td align="center" style="padding:8px 0 24px">
        <div style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;background:#eef2f6;border-radius:8px;padding:12px 20px;font-family:Consolas,monospace">${code}</div>
      </td></tr>
      <tr><td style="font-size:14px;color:#3e4c59;padding-bottom:8px">Valid for <strong>${validMinutes} minutes</strong>, single use only.</td></tr>
      <tr><td style="font-size:14px;color:#3e4c59;padding-bottom:24px">Never share this code with anyone, including department staff.</td></tr>
      <tr><td style="font-size:12px;color:#9aa5b1;border-top:1px solid #e4e7eb;padding-top:16px">If you did not try to sign in, you can safely ignore this email.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

export async function sendOtpEmail(to: string, code: string, validMinutes: number, recipientName?: string | null) {
  return sendMail({ to, ...buildOtpEmail(code, validMinutes, recipientName) });
}
