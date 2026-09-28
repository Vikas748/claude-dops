/**
 * Direct browser-to-storage uploads.
 *
 * 1. Client asks POST /api/uploads for permission to upload one file.
 *    The server checks the user's module permission, file type and size,
 *    picks the storage key itself, records an "intent", and returns a
 *    signed upload URL.
 * 2. The browser PUTs the file straight to Supabase Storage.
 * 3. The client calls the normal module API (academic / OT images /
 *    discharge) with the uploadId. That API calls claimUploads(), which
 *    re-checks the real file in storage (size + magic bytes) before the
 *    file is attached to any record.
 *
 * Unclaimed uploads are deleted by cleanupStaleUploads().
 */
import { getDopsBucket, getDopsDb } from "@/lib/dops-db";

export type UploadPurpose = "ACADEMIC" | "OT_IMAGE" | "DISCHARGE_CARD" | "BACKUP_EXPORT" | "RESTORE_PACKAGE";

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<UploadPurpose, { types: string[]; maxBytes: number; label: string }> = {
  ACADEMIC: { types: ["application/pdf"], maxBytes: 15 * MB, label: "PDF under 15 MB" },
  OT_IMAGE: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8 * MB, label: "JPG, PNG or WebP image under 8 MB" },
  DISCHARGE_CARD: { types: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 10 * MB, label: "PDF, JPG or PNG under 10 MB" },
  BACKUP_EXPORT: { types: ["application/json"], maxBytes: 50 * MB, label: "backup" },
  RESTORE_PACKAGE: { types: ["application/json"], maxBytes: 50 * MB, label: "database.json under 50 MB" },
};

const INTENT_HOURS = 2; // matches the lifetime of a Supabase signed upload URL

export class UploadError extends Error {}

export const safeFileName = (name: string) =>
  (name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(-100) || "file");

/** Does the file really start like the type it claims to be? */
export function matchesSignature(contentType: string, head: Uint8Array) {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (contentType) {
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50; // RIFF....WEBP
    case "application/json": {
      const first = Array.from(head).find((b) => ![0x20, 0x09, 0x0a, 0x0d, 0xef, 0xbb, 0xbf].includes(b));
      return first === 0x7b; // {
    }
    default:
      return false;
  }
}

/** Validates the declared file and returns a signed upload URL. */
export async function createUploadIntent(input: {
  userId: number;
  purpose: UploadPurpose;
  keyPrefix: string;
  fileName: string;
  contentType: string;
  size: number;
}) {
  const rule = UPLOAD_RULES[input.purpose];
  if (!rule.types.includes(input.contentType)) throw new UploadError(`Only ${rule.label} is allowed.`);
  if (!Number.isFinite(input.size) || input.size <= 0) throw new UploadError("The selected file is empty.");
  if (input.size > rule.maxBytes) throw new UploadError(`File is too large. Upload a ${rule.label}.`);
  const fileName = String(input.fileName || "file").slice(0, 200);
  const key = `${input.keyPrefix}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
  const uploadUrl = await getDopsBucket().signUpload(key);
  const row = await getDopsDb()
    .prepare(
      "INSERT INTO upload_intents (user_id,purpose,file_key,file_name,content_type,declared_size,expires_at) VALUES (?,?,?,?,?,?,now() + (? * interval '1 hour')) RETURNING id",
    )
    .bind(input.userId, input.purpose, key, fileName, input.contentType, input.size, INTENT_HOURS)
    .first<{ id: string }>();
  if (Math.random() < 0.05) void cleanupStaleUploads().catch((e) => console.error("Upload cleanup failed", e));
  return { uploadId: String(row?.id), uploadUrl, key };
}

export type ClaimedUpload = { key: string; fileName: string; contentType: string; size: number };

/**
 * Verifies uploads really exist in storage with the right type and size,
 * and marks them attached so they cannot be reused. Throws UploadError with
 * a user-facing message on any problem; rejected files are deleted.
 */
export async function claimUploads(input: {
  userId: number;
  purpose: UploadPurpose;
  uploadIds: unknown[];
  keyPrefix: string;
}): Promise<ClaimedUpload[]> {
  const ids = input.uploadIds.map(String);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!ids.length || ids.some((id) => !uuid.test(id)) || new Set(ids).size !== ids.length)
    throw new UploadError("Upload the file(s) again.");
  const db = getDopsDb(), bucket = getDopsBucket(), rule = UPLOAD_RULES[input.purpose];
  const claimed: (ClaimedUpload & { id: string })[] = [];
  try {
  for (const id of ids) {
    const intent = await db
      .prepare(
        `SELECT file_key AS "fileKey", file_name AS "fileName", content_type AS "contentType"
           FROM upload_intents
          WHERE id=? AND user_id=? AND purpose=? AND claimed_at IS NULL AND expires_at > now()`,
      )
      .bind(id, input.userId, input.purpose)
      .first<{ fileKey: string; fileName: string; contentType: string }>();
    if (!intent || !intent.fileKey.startsWith(`${input.keyPrefix}/`))
      throw new UploadError("This upload has expired or does not belong here. Select the file again.");
    const probe = await bucket.probe(intent.fileKey);
    if (!probe) throw new UploadError(`${intent.fileName} did not finish uploading. Try again.`);
    if (!(probe.size > 0) || probe.size > rule.maxBytes || !matchesSignature(intent.contentType, probe.head)) {
      await bucket.delete(intent.fileKey).catch(() => undefined);
      await db.prepare("DELETE FROM upload_intents WHERE id=?").bind(id).run();
      throw new UploadError(`${intent.fileName} is not a valid ${rule.label}.`);
    }
    const marked = await db
      .prepare("UPDATE upload_intents SET claimed_at=now() WHERE id=? AND claimed_at IS NULL RETURNING id")
      .bind(id)
      .first();
    if (!marked) throw new UploadError("This upload was already used. Select the file again.");
    claimed.push({ id, key: intent.fileKey, fileName: intent.fileName, contentType: intent.contentType, size: probe.size });
  }
  } catch (error) {
    // All-or-nothing: release files already verified in this call, so a
    // retry works and housekeeping can still delete them if abandoned.
    for (const item of claimed)
      await db.prepare("UPDATE upload_intents SET claimed_at=NULL WHERE id=?").bind(item.id).run().catch(() => undefined);
    throw error;
  }
  return claimed.map(({ id: _id, ...file }) => (void _id, file));
}

/** Removes verified files whose database save failed (storage + intent). */
export async function discardUploads(files: ClaimedUpload[]) {
  const db = getDopsDb(), bucket = getDopsBucket();
  for (const file of files) {
    await bucket.delete(file.key).catch(() => undefined);
    await db.prepare("DELETE FROM upload_intents WHERE file_key=?").bind(file.key).run().catch(() => undefined);
  }
}

/** Records a server-created file (e.g. a backup export) so housekeeping deletes it later. */
export async function trackServerFile(userId: number, purpose: UploadPurpose, key: string, fileName: string, contentType: string, size: number) {
  await getDopsDb()
    .prepare(
      "INSERT INTO upload_intents (user_id,purpose,file_key,file_name,content_type,declared_size,expires_at) VALUES (?,?,?,?,?,?,now() + interval '1 hour')",
    )
    .bind(userId, purpose, key, fileName, contentType, size)
    .run();
}

/**
 * Deletes files that were uploaded but never attached (after a day), and
 * backup/restore packages (after an hour). Attached files are never touched.
 */
export async function cleanupStaleUploads(limit = 50) {
  const db = getDopsDb(), bucket = getDopsBucket();
  const stale = await db
    .prepare(
      `SELECT id, file_key AS "fileKey" FROM upload_intents
        WHERE claimed_at IS NULL
          AND (created_at < now() - interval '1 day'
               -- full-database backups/restore packages hold all patient data: keep them only briefly
               OR (purpose IN ('BACKUP_EXPORT','RESTORE_PACKAGE') AND created_at < now() - interval '1 hour'))
        ORDER BY created_at LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; fileKey: string }>();
  let removed = 0;
  for (const row of stale.results) {
    try {
      await bucket.delete(row.fileKey);
      await db.prepare("DELETE FROM upload_intents WHERE id=?").bind(row.id).run();
      removed += 1;
    } catch (error) {
      console.error("Could not delete stale upload", error);
    }
  }
  return removed;
}
