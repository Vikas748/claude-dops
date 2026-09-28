/**
 * Field-level encryption for sensitive identifiers in register records
 * (Aadhaar number, bank account number). AES-256-GCM with a key that lives
 * only in the DATA_ENCRYPTION_KEY environment variable, never in the database:
 * a database leak or a backup file alone does not reveal these numbers.
 *
 * Stored form:  enc:v1:<base64 iv>:<base64 ciphertext+tag>
 * The field name is authenticated too, so a value cannot be moved to another field.
 *
 * Values without the prefix are treated as legacy plaintext and are encrypted
 * the next time the record is saved.
 *
 * Server-only module.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

/** Payload keys that are encrypted at rest and masked for non-admins. */
export const isSensitiveField = (key: string) => /aadhaar|adhar|account/i.test(key);

export class EncryptionConfigError extends Error {}

function key() {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionConfigError("DATA_ENCRYPTION_KEY is not set.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new EncryptionConfigError("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return bytes;
}

export const isEncrypted = (value: unknown) => typeof value === "string" && value.startsWith(PREFIX);

export function encryptField(field: string, value: string) {
  if (!value || isEncrypted(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(field, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${iv.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptField(field: string, value: unknown): string {
  if (!isEncrypted(value)) return String(value ?? "");
  const [ivB64, dataB64] = String(value).slice(PREFIX.length).split(":");
  const data = Buffer.from(dataB64 ?? "", "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64 ?? "", "base64"));
  decipher.setAAD(Buffer.from(field, "utf8"));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
}

/** Encrypts every sensitive field of a payload (returns a new object). */
export function encryptPayload(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...payload };
  for (const [k, v] of Object.entries(out)) if (isSensitiveField(k) && v !== null && v !== undefined && v !== "") out[k] = encryptField(k, String(v));
  return out;
}

/**
 * Decrypts sensitive fields. If a value cannot be decrypted (key missing or
 * changed) it is shown as "[unreadable]" instead of failing the whole list.
 */
export function decryptPayload(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...payload };
  for (const [k, v] of Object.entries(out)) {
    if (!isSensitiveField(k) || !isEncrypted(v)) continue;
    try {
      out[k] = decryptField(k, v);
    } catch (error) {
      console.error(`Could not decrypt field "${k}"`, error instanceof Error ? error.message : error);
      out[k] = "[unreadable]";
    }
  }
  return out;
}

/** XXXXXXXX1234 */
export const maskValue = (value: unknown) => {
  const s = String(value ?? "");
  return s.length > 4 ? `${"X".repeat(s.length - 4)}${s.slice(-4)}` : s;
};

/** Masks sensitive fields for users who may not see them in full. */
export function maskPayload(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...payload };
  for (const k of Object.keys(out)) if (isSensitiveField(k)) out[k] = maskValue(out[k]);
  return out;
}

/** A value the client sent back unchanged from a masked view (e.g. "XXXXXXXX1234"). */
export const looksMasked = (value: unknown) => /^X+\d{0,4}$/.test(String(value ?? ""));
