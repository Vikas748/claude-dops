import { getDopsDb, jsonError } from "@/lib/dops-db";
import { AUTH_LIMITS, cleanupAuthTables, clientIp, generateOtp, hashOtp, isValidEmail, normaliseEmail } from "@/lib/auth";
import { MailerConfigError, maskEmail, sendOtpEmail } from "@/lib/mailer";
import { enforceRequestSize, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";

// Same reply whether or not the email is registered, so nobody can probe
// which addresses have DOPS accounts.
const GENERIC_REPLY = "If this email is registered with DOPS, a 6-digit sign-in code has been sent to it.";

const tooMany = (message: string, retryAfterSeconds: number) =>
  Response.json(
    { success: false, message, retryAfter: retryAfterSeconds },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );

/** Who may receive a code: an ACTIVE user, or the bootstrap admin while no active admin exists. */
async function eligibleRecipient(email: string) {
  const db = getDopsDb();
  const user = await db
    .prepare("SELECT name,status FROM department_users WHERE lower(email)=? LIMIT 1")
    .bind(email)
    .first<{ name: string; status: string }>();
  if (user) return user.status === "ACTIVE" ? { name: user.name } : null;
  const bootstrap = normaliseEmail(process.env.DOPS_BOOTSTRAP_ADMIN_EMAIL);
  if (!bootstrap || bootstrap !== email) return null;
  const admins = await db
    .prepare("SELECT COUNT(*) AS n FROM department_users WHERE role='ADMIN' AND status='ACTIVE'")
    .first<{ n: number }>();
  return Number(admins?.n ?? 0) === 0 ? { name: null } : null;
}

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 4 * 1024);
    if (rejected) return rejected;
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    const email = normaliseEmail(body.email);
    if (!isValidEmail(email)) return jsonError("Enter a valid email address.");

    const db = getDopsDb(), ip = await clientIp();

    // Rate limits live in the database, so they hold across all Vercel instances.
    const counts = await db
      .prepare(
        `SELECT
           (COUNT(1) FILTER (WHERE request_ip = ?))::int AS "perIp",
           (COUNT(1) FILTER (WHERE email = ?))::int AS "perEmail",
           COALESCE(EXTRACT(EPOCH FROM (now() - MAX(created_at) FILTER (WHERE email = ?))), 1e9)::int AS "sinceLast"
         FROM auth_otps WHERE created_at > now() - interval '1 hour' AND (request_ip = ? OR email = ?)`,
      )
      .bind(ip, email, email, ip, email)
      .first<{ perIp: number; perEmail: number; sinceLast: number }>();
    if (Number(counts?.perIp) >= AUTH_LIMITS.otpPerIpPerHour)
      return tooMany("Too many sign-in attempts from this network. Please try again later.", 900);
    if (Number(counts?.perEmail) >= AUTH_LIMITS.otpPerEmailPerHour)
      return tooMany("Too many codes requested for this email. Please try again in an hour.", 3600);
    const sinceLast = Number(counts?.sinceLast ?? 1e9);
    if (sinceLast < AUTH_LIMITS.resendCooldownSeconds) {
      const wait = AUTH_LIMITS.resendCooldownSeconds - sinceLast;
      return tooMany(`Please wait ${wait} seconds before requesting another code.`, wait);
    }

    const recipient = await eligibleRecipient(email);
    const code = generateOtp();

    // Every request is recorded (even for unknown emails, with an undeliverable
    // code) so the rate limits above apply equally to everyone.
    await db.batch([
      db.prepare("UPDATE auth_otps SET consumed_at=now() WHERE email=? AND consumed_at IS NULL").bind(email),
      db.prepare(
        "INSERT INTO auth_otps (email,code_hash,max_attempts,request_ip,expires_at) VALUES (?,?,?,?,now() + (? * interval '1 minute'))",
      ).bind(email, recipient ? hashOtp(email, code) : hashOtp(email, `x${code}`), AUTH_LIMITS.otpMaxAttempts, ip, AUTH_LIMITS.otpValidMinutes),
    ]);

    if (recipient) {
      try {
        await sendOtpEmail(email, code, AUTH_LIMITS.otpValidMinutes, recipient.name);
      } catch (error) {
        // Don't leave a live code behind for an email that never arrived.
        await db.prepare("UPDATE auth_otps SET consumed_at=now() WHERE email=? AND consumed_at IS NULL").bind(email).run();
        console.error(`OTP email to ${maskEmail(email)} failed`, error);
        return jsonError(
          error instanceof MailerConfigError
            ? "Email service is not configured. Contact the administrator."
            : "The sign-in code could not be emailed. Please try again shortly.",
          503,
        );
      }
    }

    if (Math.random() < 0.05) void cleanupAuthTables().catch((e) => console.error("Auth cleanup failed", e));

    return Response.json({
      success: true,
      message: GENERIC_REPLY,
      validMinutes: AUTH_LIMITS.otpValidMinutes,
      resendAfter: AUTH_LIMITS.resendCooldownSeconds,
    });
  } catch (error) {
    console.error("OTP request failed", error);
    return jsonError("Sign-in is temporarily unavailable. Please try again shortly.", 503);
  }
}
