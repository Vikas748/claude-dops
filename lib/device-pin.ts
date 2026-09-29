/**
 * Quick sign-in with a 4-digit PIN on a trusted device.
 *
 * - A PIN is only offered after a normal email-code sign-in on that device.
 * - The device holds a random token in an httpOnly cookie; the database keeps
 *   only SHA-256(token). The PIN is stored as scrypt(random salt, PIN peppered
 *   with AUTH_SECRET). A PIN is useless on any other device.
 * - 5 wrong PINs lock the device's PIN; the email code is then required and a
 *   new PIN can be set afterwards.
 *
 * Server-only module.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getDopsDb } from "@/lib/dops-db";

export const DEVICE_COOKIE = "dops_device";
export const PIN_MAX_ATTEMPTS = 5;
const DEVICE_DAYS = 365;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function pepper(pin: string) {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters.");
  return createHmac("sha256", secret).update(`pin:${pin}`).digest();
}

export const isValidPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4}$/.test(pin);

/** Rejects PINs that are trivial to guess. */
export function weakPinReason(pin: string) {
  if (/^(\d)\1{3}$/.test(pin)) return "Avoid PINs with the same digit four times.";
  const up = "0123456789012", down = "9876543210987";
  if (up.includes(pin) || down.includes(pin)) return "Avoid sequences such as 1234 or 4321.";
  return null;
}

export function hashPin(pin: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pepper(pin), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function pinMatches(pin: string, stored: string) {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(pepper(pin), Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

async function deviceToken() {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

export type DeviceRow = {
  id: number;
  userId: number;
  pinHash: string;
  failedAttempts: number;
  locked: boolean;
  name: string;
  email: string;
  status: string;
};

/** The PIN device registered in this browser, if any. */
export async function currentDevice(): Promise<DeviceRow | null> {
  const token = await deviceToken();
  if (!token || token.length > 200) return null;
  const row = await getDopsDb()
    .prepare(
      `SELECT d.id, d.user_id AS "userId", d.pin_hash AS "pinHash", d.failed_attempts AS "failedAttempts",
              d.locked_at IS NOT NULL AS "locked", u.name, u.email, u.status
         FROM auth_devices d JOIN department_users u ON u.id = d.user_id
        WHERE d.token_hash = ?`,
    )
    .bind(sha256(token))
    .first<DeviceRow>();
  return row ? { ...row, id: Number(row.id), userId: Number(row.userId), failedAttempts: Number(row.failedAttempts) } : null;
}

/** Sets (or resets) the PIN for this browser and signed-in user. */
export async function registerDevicePin(userId: number, pin: string) {
  const db = getDopsDb();
  const existing = await currentDevice();
  const pinHash = hashPin(pin);
  if (existing && existing.userId === userId) {
    await db.prepare("UPDATE auth_devices SET pin_hash=?, failed_attempts=0, locked_at=NULL WHERE id=?").bind(pinHash, existing.id).run();
    return;
  }
  // Another user's PIN on this browser (shared computer) is replaced.
  if (existing) await db.prepare("DELETE FROM auth_devices WHERE id=?").bind(existing.id).run();
  const token = randomBytes(32).toString("base64url");
  const agent = ((await headers()).get("user-agent") ?? "").slice(0, 300);
  await db
    .prepare("INSERT INTO auth_devices (user_id, token_hash, pin_hash, user_agent) VALUES (?,?,?,?)")
    .bind(userId, sha256(token), pinHash, agent)
    .run();
  (await cookies()).set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_DAYS * 86_400,
  });
}

/** Removes the PIN from this browser. */
export async function forgetDevice() {
  const token = await deviceToken();
  if (token) await getDopsDb().prepare("DELETE FROM auth_devices WHERE token_hash=?").bind(sha256(token)).run();
  (await cookies()).delete(DEVICE_COOKIE);
}

/**
 * Uses up one attempt BEFORE the PIN is checked, atomically, so parallel
 * guesses can never exceed the limit. Returns attempts left after this one,
 * or null when the PIN is already locked. Reaching the limit locks it.
 */
export async function claimPinAttempt(deviceId: number) {
  const row = await getDopsDb()
    .prepare(
      `UPDATE auth_devices
          SET failed_attempts = failed_attempts + 1,
              locked_at = CASE WHEN failed_attempts + 1 >= ? THEN now() ELSE NULL END
        WHERE id = ? AND locked_at IS NULL
        RETURNING failed_attempts AS "failedAttempts"`,
    )
    .bind(PIN_MAX_ATTEMPTS, deviceId)
    .first<{ failedAttempts: number }>();
  return row ? PIN_MAX_ATTEMPTS - Number(row.failedAttempts) : null;
}

export async function recordPinSuccess(deviceId: number) {
  // A correct PIN clears the count (and the lock set by that same attempt).
  await getDopsDb().prepare("UPDATE auth_devices SET failed_attempts=0, locked_at=NULL, last_used_at=now() WHERE id=?").bind(deviceId).run();
}

/** "d***@hospital.in" for showing whose PIN this is without revealing the full address. */
export function maskedEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

// A short-lived proof that the email code was just entered, required to set a
// PIN on a browser whose app is locked (otherwise anyone holding the locked
// device could set a new PIN and get in).
export const PIN_SETUP_COOKIE = "dops_pin_setup";
const setupValue = (sessionId: number) => createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`pin-setup:${sessionId}`).digest("base64url");

export async function issuePinSetupTicket(sessionId: number) {
  (await cookies()).set(PIN_SETUP_COOKIE, setupValue(sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/pin",
    maxAge: 10 * 60,
  });
}

export async function hasPinSetupTicket(sessionId: number) {
  const value = (await cookies()).get(PIN_SETUP_COOKIE)?.value;
  if (!value) return false;
  const a = Buffer.from(value), b = Buffer.from(setupValue(sessionId));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function clearPinSetupTicket() {
  (await cookies()).delete({ name: PIN_SETUP_COOKIE, path: "/api/auth/pin" });
}
