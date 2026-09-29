import { getDopsDb, jsonError } from "@/lib/dops-db";
import { isValidEmail, normaliseEmail } from "@/lib/auth";
import { maskEmail, sendMail } from "@/lib/mailer";
import { enforceRequestSize, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";

// Same reply in every case, so the form cannot be used to find out which
// email addresses already have a DOPS account.
const REPLY =
  "Request received. The department administrator will review it; you will get an email when your access is approved.";
const ROLES = ["DOCTOR", "RESIDENT", "NURSE", "STAFF"]; // Admin access is only ever granted by an Admin
const HOURLY_LIMIT = 10; // new requests per hour, all users together

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * "Request an account" from the sign-in page. Creates the user as PENDING
 * (no access, no sign-in code) and emails the active Admins, who approve it
 * in Admin → Users by setting the status to ACTIVE and choosing permissions.
 */
export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 8 * 1024);
    if (rejected) return rejected;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Hidden field that people never fill in; simple bots do.
    if (clean(b.website, 100)) return Response.json({ success: true, message: REPLY });

    const name = clean(b.name, 100),
      email = normaliseEmail(b.email),
      mobile = String(b.mobile ?? "").replace(/\D/g, ""),
      role = String(b.role ?? "").toUpperCase(),
      note = clean(b.note, 300);
    if (name.length < 2) return jsonError("Enter your full name.");
    if (!isValidEmail(email)) return jsonError("Enter a valid email address.");
    if (mobile.length !== 10) return jsonError("Enter a 10-digit mobile number.");
    if (!ROLES.includes(role)) return jsonError("Choose your role.");

    const db = getDopsDb(),
      now = new Date().toISOString();
    const recent = await db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='ACCOUNT_REQUEST' AND created_at > ?")
      .bind(new Date(Date.now() - 3_600_000).toISOString())
      .first<{ n: number }>();
    if (Number(recent?.n ?? 0) >= HOURLY_LIMIT)
      return jsonError("Too many account requests right now. Please try again in an hour.", 429);

    const existing = await db.prepare("SELECT id FROM department_users WHERE lower(email)=?").bind(email).first();
    if (existing) return Response.json({ success: true, message: REPLY });

    const created = await db
      .prepare(
        "INSERT INTO department_users (name,email,mobile,role,status,permissions,created_at,updated_at) VALUES (?,?,?,?,'PENDING','[]',?,?) ON CONFLICT DO NOTHING RETURNING id",
      )
      .bind(name, email, mobile, role, now, now)
      .first<{ id: number }>();
    if (!created) return Response.json({ success: true, message: REPLY });

    await db
      .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('ACCOUNT_REQUEST','ADMIN',?,?,?)")
      .bind(created.id, `Account requested: ${name} <${email}> as ${role}${note ? ` — ${note}` : ""}`.slice(0, 480), now)
      .run();

    // Tell the Admins. A mail failure must not lose the request, which is already saved.
    try {
      const admins = await db
        .prepare("SELECT lower(email) AS email FROM department_users WHERE role='ADMIN' AND status='ACTIVE'")
        .all<{ email: string }>();
      const to = admins.results.map((a) => a.email);
      if (to.length) {
        const origin = new URL(request.url).origin;
        await sendMail({
          to: process.env.SMTP_USER?.trim() || to[0],
          bcc: to,
          subject: `DOPS: new account request from ${name}`,
          text: [
            "A new DOPS account has been requested.",
            "",
            `Name: ${name}`,
            `Email: ${email}`,
            `Mobile: ${mobile}`,
            `Role requested: ${role}`,
            ...(note ? [`Note: ${note}`] : []),
            "",
            `To approve: sign in at ${origin}, open Admin → Users, edit this user, set Status to ACTIVE and choose their module permissions.`,
            "If you do not recognise this person, leave the request as PENDING or set it to INACTIVE.",
          ].join("\n"),
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f1b2d">
<h2 style="margin:0 0 12px">New DOPS account request</h2>
<table cellpadding="4" style="border-collapse:collapse">
<tr><td style="color:#5f6b7e">Name</td><td><strong>${escapeHtml(name)}</strong></td></tr>
<tr><td style="color:#5f6b7e">Email</td><td>${escapeHtml(email)}</td></tr>
<tr><td style="color:#5f6b7e">Mobile</td><td>${escapeHtml(mobile)}</td></tr>
<tr><td style="color:#5f6b7e">Role requested</td><td>${escapeHtml(role)}</td></tr>
${note ? `<tr><td style="color:#5f6b7e">Note</td><td>${escapeHtml(note)}</td></tr>` : ""}
</table>
<p>To approve: sign in at <a href="${escapeHtml(origin)}">${escapeHtml(origin)}</a>, open <strong>Admin → Users</strong>, edit this user, set Status to <strong>ACTIVE</strong> and choose their module permissions.</p>
<p style="color:#5f6b7e;font-size:13px">If you do not recognise this person, leave the request as PENDING or set it to INACTIVE.</p></div>`,
        });
      }
    } catch (error) {
      console.error(`Account request mail for ${maskEmail(email)} failed`, error);
    }
    return Response.json({ success: true, message: REPLY });
  } catch (error) {
    console.error("Account request failed", error);
    return jsonError("Could not send the request. Please try again shortly.", 503);
  }
}
