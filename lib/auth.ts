/**
 * DOPS self-hosted authentication: 6-digit email OTP + database sessions.
 *
 * - OTP codes are never stored; only HMAC-SHA256(AUTH_SECRET, "email:code").
 * - Session tokens are never stored; only SHA-256(token).
 * - Web clients get an httpOnly cookie. The future mobile app gets the same
 *   token in the JSON response and sends it as "Authorization: Bearer <token>".
 *
 * Server-only module.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getDopsDb } from "@/lib/dops-db";

export const SESSION_COOKIE = "dops_session";

export const AUTH_LIMITS = {
  otpValidMinutes: 10,
  otpMaxAttempts: 5,
  resendCooldownSeconds: 60,
  otpPerEmailPerHour: 5,
  otpPerIpPerHour: 20,
  sessionDays: 30,
  // Sessions slide forward on use, but we only write to the DB this often.
  sessionTouchMinutes: 10,
} as const;

export type SessionClient = "WEB" | "MOBILE";

export type SessionUser = {
  sessionId: number;
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: string;
};

function authSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters.");
  return secret;
}

export const normaliseEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
export const isValidEmail = (email: string) =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(email: string, code: string) {
  return createHmac("sha256", authSecret()).update(`${email}:${code}`).digest("hex");
}

export function otpMatches(email: string, code: string, storedHash: string) {
  const expected = Buffer.from(hashOtp(email, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function clientIp() {
  const h = await headers();
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);
}

const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeSeconds,
});

/** Creates a session row. Returns the raw token — shown to the client once, never stored. */
export async function createSession(userId: number, client: SessionClient) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const row = await getDopsDb()
    .prepare(
      "INSERT INTO auth_sessions (user_id,token_hash,client,user_agent,ip,expires_at) VALUES (?,?,?,?,?,now() + (? * interval '1 day')) RETURNING expires_at AS expiresAt",
    )
    .bind(userId, hashToken(token), client, (h.get("user-agent") ?? "").slice(0, 300), await clientIp(), AUTH_LIMITS.sessionDays)
    .first<{ expiresAt: Date }>();
  if (client === "WEB")
    (await cookies()).set(SESSION_COOKIE, token, cookieOptions(AUTH_LIMITS.sessionDays * 86_400));
  return { token, expiresAt: row?.expiresAt ?? null };
}

async function presentedToken() {
  const bearer = (await headers()).get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) return { token: bearer, client: "MOBILE" as const };
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return cookie ? { token: cookie, client: "WEB" as const } : null;
}

/** Resolves the signed-in user from cookie or Bearer token, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const presented = await presentedToken();
  if (!presented || presented.token.length > 200) return null;
  const db = getDopsDb();
  const row = await db
    .prepare(
      `SELECT s.id AS sessionId, s.last_seen_at < now() - (? * interval '1 minute') AS stale,
              u.id, u.name, u.email, u.role, u.status, u.permissions
         FROM auth_sessions s JOIN department_users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > now()`,
    )
    .bind(AUTH_LIMITS.sessionTouchMinutes, hashToken(presented.token))
    .first<SessionUser & { stale: boolean }>();
  if (!row) return null;
  if (row.stale) {
    // Sliding expiry: an active user stays signed in; an idle one expires after sessionDays.
    await db
      .prepare("UPDATE auth_sessions SET last_seen_at=now(), expires_at=now() + (? * interval '1 day') WHERE id=?")
      .bind(AUTH_LIMITS.sessionDays, row.sessionId)
      .run();
    if (presented.client === "WEB") {
      try {
        (await cookies()).set(SESSION_COOKIE, presented.token, cookieOptions(AUTH_LIMITS.sessionDays * 86_400));
      } catch {
        // cookies() is read-only outside route handlers; the DB expiry still slides.
      }
    }
  }
  const { stale: _stale, ...user } = row;
  void _stale;
  return { ...user, id: Number(user.id), sessionId: Number(user.sessionId) };
}

/** Revokes the presented session (logout) and clears the web cookie. */
export async function revokeCurrentSession() {
  const presented = await presentedToken();
  if (presented) {
    const db = getDopsDb();
    const ended = await db
      .prepare("UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=? AND revoked_at IS NULL RETURNING user_id AS \"userId\", client")
      .bind(hashToken(presented.token))
      .first<{ userId: number; client: string }>();
    if (ended)
      await db
        .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('LOGOUT','AUTH',?,?,?)")
        .bind(ended.userId, `User #${ended.userId}: signed out (${ended.client})`, new Date().toISOString())
        .run();
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/** Revokes every session of a user — used when an admin deactivates them. */
export async function revokeAllSessions(userId: number) {
  await getDopsDb()
    .prepare("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=? AND revoked_at IS NULL")
    .bind(userId)
    .run();
}

/** Occasional housekeeping so the auth tables don't grow forever. */
export async function cleanupAuthTables() {
  const db = getDopsDb();
  await db.batch([
    db.prepare("DELETE FROM auth_otps WHERE expires_at < now() - interval '1 day'"),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'"),
  ]);
}
