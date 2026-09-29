import { getDopsDb, jsonError } from "@/lib/dops-db";
import { createSession, isValidEmail, normaliseEmail, otpMatches, unlockSession, type SessionClient } from "@/lib/auth";
import { maskEmail } from "@/lib/mailer";
import { currentDevice, issuePinSetupTicket } from "@/lib/device-pin";
import { enforceRequestSize, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";

type UserRow = { id: number; name: string; role: string; status: string };

/** Finds the user, creating the first administrator from DOPS_BOOTSTRAP_ADMIN_EMAIL if needed. */
async function resolveUser(email: string): Promise<UserRow | null> {
  const db = getDopsDb();
  const existing = await db
    .prepare("SELECT id,name,role,status FROM department_users WHERE lower(email)=? LIMIT 1")
    .bind(email)
    .first<UserRow>();
  if (existing) return existing;
  const bootstrap = normaliseEmail(process.env.DOPS_BOOTSTRAP_ADMIN_EMAIL);
  if (!bootstrap || bootstrap !== email) return null;
  const now = new Date().toISOString();
  // Conditional insert: only succeeds while no active admin exists.
  return db
    .prepare(
      `INSERT INTO department_users (name,email,role,status,permissions,created_at,updated_at)
       SELECT ?,?,'ADMIN','ACTIVE','[]',?,?
        WHERE NOT EXISTS (SELECT 1 FROM department_users WHERE role='ADMIN' AND status='ACTIVE')
       ON CONFLICT DO NOTHING
       RETURNING id,name,role,status`,
    )
    .bind(email, email, now, now)
    .first<UserRow>();
}

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 4 * 1024);
    if (rejected) return rejected;
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown; client?: unknown };
    const email = normaliseEmail(body.email);
    const code = String(body.code ?? "").replace(/\s+/g, "");
    const client: SessionClient = body.client === "MOBILE" ? "MOBILE" : "WEB";
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return jsonError("Enter the 6-digit code sent to your email.");

    const db = getDopsDb();
    // Count the attempt atomically BEFORE checking the code, so parallel
    // guesses can never exceed max_attempts.
    const otp = await db
      .prepare(
        `UPDATE auth_otps SET attempts = attempts + 1
          WHERE id = (SELECT id FROM auth_otps
                       WHERE email = ? AND consumed_at IS NULL AND expires_at > now()
                       ORDER BY created_at DESC LIMIT 1)
            AND attempts < max_attempts
        RETURNING id, code_hash AS "codeHash", attempts, max_attempts AS "maxAttempts"`,
      )
      .bind(email)
      .first<{ id: number; codeHash: string; attempts: number; maxAttempts: number }>();
    if (!otp) return jsonError("This code has expired or is no longer valid. Request a new code.", 401);

    if (!otpMatches(email, code, otp.codeHash)) {
      const left = otp.maxAttempts - otp.attempts;
      if (left <= 0) await db.prepare("UPDATE auth_otps SET consumed_at=now() WHERE id=?").bind(otp.id).run();
      return jsonError(
        left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "Too many incorrect attempts. Request a new code.",
        401,
      );
    }

    // Single use: only one concurrent request can consume the code.
    const consumed = await db
      .prepare("UPDATE auth_otps SET consumed_at=now() WHERE id=? AND consumed_at IS NULL RETURNING id")
      .bind(otp.id)
      .first<{ id: number }>();
    if (!consumed) return jsonError("This code has already been used. Request a new code.", 401);

    const user = await resolveUser(email);
    const now = new Date().toISOString();
    if (!user || user.status !== "ACTIVE") {
      if (user)
        await db
          .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('LOGIN_DENIED','AUTH',?,?,?)")
          .bind(user.id, `User #${user.id} (${user.role}): access ${user.status}`, now)
          .run();
      return jsonError("Your access is not active. Contact the department administrator.", 403);
    }

    const session = await createSession(Number(user.id), client);
    await db.batch([
      db.prepare("UPDATE department_users SET last_login=? WHERE id=?").bind(now, user.id),
      db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('LOGIN','AUTH',?,?,?)")
        .bind(user.id, `User #${user.id} (${user.role}): email OTP sign-in (${client})`, now),
    ]);
    console.info(`Sign-in: ${maskEmail(email)} (${client})`);

    // PIN is mandatory on the web. If this browser already has this user's working
    // PIN, the email code unlocks the app now; otherwise the user must set a PIN
    // first (allowed for 10 minutes by a setup ticket) and the app stays locked.
    let requirePin = false;
    if (client === "WEB") {
      const device = await currentDevice().catch(() => null);
      requirePin = !device || device.userId !== Number(user.id) || device.locked;
      if (requirePin) await issuePinSetupTicket(session.sessionId);
      else await unlockSession(session.sessionId);
    }
    return Response.json({
      success: true,
      requirePin,
      offerPin: requirePin, // older clients
      user: { name: user.name, role: user.role },
      // Only mobile clients receive the raw token; web uses the httpOnly cookie.
      ...(client === "MOBILE" ? { token: session.token, expiresAt: session.expiresAt } : {}),
    });
  } catch (error) {
    console.error("OTP verification failed", error);
    return jsonError("Sign-in is temporarily unavailable. Please try again shortly.", 503);
  }
}
