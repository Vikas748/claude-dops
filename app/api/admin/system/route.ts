import { createSession, unlockSession } from "@/lib/auth";
import { getDopsAccess, isResponse } from "@/lib/access";
import { getDopsBucket, getDopsDb, jsonError } from "@/lib/dops-db";
import { claimUploads, createUploadIntent, discardUploads, trackServerFile, UploadError } from "@/lib/uploads";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";
// Backup/restore of a large database can take longer than the default.
export const maxDuration = 60;

const tableColumns = {
  patients: ["id", "patient_code", "name", "age", "sex", "mobile", "address", "created_at", "updated_at", "deleted_at"],
  opd_visits: ["id", "patient_id", "diagnosis", "visit_date", "status", "created_at", "updated_at", "deleted_at"],
  ipd_admissions: ["id", "patient_id", "opd_visit_id", "diagnosis", "admission_date", "plan_management", "ayushman_code", "status", "created_at", "updated_at"],
  ward_stays: ["id", "ipd_id", "ward_name", "bed_number", "pac_status", "admitted_at", "discharged_at", "updated_at"],
  ot_procedures: ["id", "ipd_id", "scheduled_date", "scheduled_time", "procedure_name", "surgeon_name", "pac_status", "status", "created_at", "updated_at"],
  ot_images: ["id", "ot_id", "image_type", "file_key", "file_name", "mime_type", "size_bytes", "created_at", "deleted_at"],
  discharge_records: ["id", "ipd_id", "discharge_date", "notes", "card_key", "card_name", "created_at"],
  academic_documents: ["id", "kind", "title", "doctor_name", "document_date", "file_key", "file_name", "external_url", "created_at", "deleted_at"],
  special_records: ["id", "kind", "patient_id", "record_date", "primary_name", "status", "payload", "created_at", "updated_at", "deleted_at"],
  register_columns: ["id", "kind", "name", "data_type", "position", "created_at", "deleted_at"],
  special_record_versions: ["id", "record_id", "kind", "primary_name", "status", "payload", "changed_by", "created_at"],
  department_users: ["id", "user_key", "name", "email", "mobile", "role", "status", "permissions", "created_at", "updated_at", "last_login"],
  audit_logs: ["id", "action", "module", "record_id", "details", "created_at"],
  uat_results: ["id", "status", "notes", "tested_by", "tested_at", "updated_at"],
  hospital_acceptance: ["id", "department_representative", "it_representative", "decision", "limitations", "accepted_by", "accepted_at", "updated_at"],
} as const;
type TableName = keyof typeof tableColumns;
const tables = Object.keys(tableColumns) as TableName[];
const restoreOrder: TableName[] = ["patients", "opd_visits", "ipd_admissions", "ward_stays", "ot_procedures", "ot_images", "discharge_records", "academic_documents", "special_records", "register_columns", "special_record_versions", "department_users", "audit_logs", "uat_results", "hospital_acceptance"];
const serialTables: TableName[] = ["patients", "opd_visits", "ipd_admissions", "ward_stays", "ot_procedures", "ot_images", "discharge_records", "academic_documents", "special_records", "register_columns", "special_record_versions", "department_users", "audit_logs"];

async function requireAdmin() {
  const access = await getDopsAccess();
  if (isResponse(access)) return access;
  if (access.role !== "ADMIN") return jsonError("Admin access required.", 403);
  return access;
}

function allowedFileKey(key: string) {
  return ["academic/", "discharge/", "patients/"].some((prefix) => key.startsWith(prefix)) && !key.includes("..");
}

async function snapshot() {
  const db = getDopsDb(), data: Record<string, unknown[]> = {};
  for (const table of tables) {
    const result = await db.prepare(`SELECT * FROM ${table}`).all();
    data[table] = result.results;
  }
  const files = new Map<string, { key: string; name: string; contentType: string }>();
  for (const row of data.ot_images as Record<string, unknown>[]) {
    if (row.file_key) files.set(String(row.file_key), { key: String(row.file_key), name: String(row.file_name), contentType: String(row.mime_type) });
  }
  for (const row of data.academic_documents as Record<string, unknown>[]) {
    if (row.file_key) files.set(String(row.file_key), { key: String(row.file_key), name: String(row.file_name), contentType: "application/pdf" });
  }
  for (const row of data.discharge_records as Record<string, unknown>[]) {
    if (row.card_key) {
      const name = String(row.card_name ?? row.card_key).toLowerCase();
      const contentType = name.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(name) ? "image/jpeg" : "application/pdf";
      files.set(String(row.card_key), { key: String(row.card_key), name: String(row.card_name), contentType });
    }
  }
  return { format: "DOPS_RECOVERY_PACKAGE", schemaVersion: 1, exportedAt: new Date().toISOString(), includesFileMetadata: true, includesFileContents: true, files: [...files.values()], data };
}

export async function GET(request: Request) {
  try {
    const access = await requireAdmin();
    if (access instanceof Response) return access;
    const fileKey = new URL(request.url).searchParams.get("file");
    if (fileKey) {
      if (!allowedFileKey(fileKey)) return jsonError("Invalid backup file key.");
      const signed = await getDopsBucket().signDownload(fileKey, 300);
      if (!signed) return jsonError("Backup file is missing from storage.", 404);
      return new Response(null, { status: 302, headers: { location: signed, "cache-control": "no-store" } });
    }
    const db = getDopsDb();
    getDopsBucket();
    const results = await Promise.all(tables.map(async (table) => {
      const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
      return [table, Number(row?.count ?? 0)] as const;
    }));
    const latest = await db.prepare("SELECT created_at AS createdAt FROM audit_logs WHERE action IN ('BACKUP','RESTORE') ORDER BY id DESC LIMIT 1").first<{ createdAt: string }>();
    return Response.json({ success: true, data: { database: "HEALTHY", storage: "AVAILABLE", checkedAt: new Date().toISOString(), lastBackupAt: latest?.createdAt ?? null, counts: Object.fromEntries(results) } });
  } catch (error) {
    console.error(error);
    return jsonError("System health check failed.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireAdmin();
    if (access instanceof Response) return access;
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 64 * 1024);
    if (rejected) return rejected;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>, action = String(body.action ?? "backup"), db = getDopsDb(), now = new Date().toISOString();
    const bucket = getDopsBucket();
    // A restore asks for one signed URL per file, so that action gets a high limit.
    const limited = action === "restoreFileUrl" ? rateLimit(access, "recovery-file", 600, 60_000) : rateLimit(access, "recovery-action", 6, 60_000);
    if (limited) return limited;
    if (action === "backup") {
      // Written to private storage and downloaded by the browser via a signed
      // URL, so the package size is not limited by Vercel's 4.5 MB response cap.
      const snap = await snapshot();
      const bytes = new TextEncoder().encode(JSON.stringify(snap));
      const key = `backups/exports/${now.replace(/[:.]/g, "-")}-${crypto.randomUUID()}.json`;
      await bucket.put(key, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "application/json" } });
      await trackServerFile(access.id, "BACKUP_EXPORT", key, "database.json", "application/json", bytes.byteLength); // auto-deleted after 1 hour
      const url = await bucket.signDownload(key, 600);
      await db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('BACKUP','ADMIN',NULL,?,?)").bind(actorDetails(access, "Full recovery package downloaded"), now).run();
      return Response.json({ success: true, data: { url, exportedAt: snap.exportedAt, fileCount: snap.files.length } }, { headers: { "cache-control": "no-store" } });
    }
    if (action === "restoreFileUrl") {
      // Signed URL to put one file from the recovery package back at its original key.
      const key = String(body.key ?? "");
      if (!allowedFileKey(key)) return jsonError("Invalid restore file key.");
      return Response.json({ success: true, data: { uploadUrl: await bucket.signUpload(key, { upsert: true }) } });
    }
    if (action === "restorePackageUrl") {
      const intent = await createUploadIntent({ userId: access.id, purpose: "RESTORE_PACKAGE", keyPrefix: "backups/restore", fileName: "database.json", contentType: "application/json", size: Number(body.size) });
      return Response.json({ success: true, data: { uploadId: intent.uploadId, uploadUrl: intent.uploadUrl } });
    }
    if (action !== "restore") return jsonError("Invalid recovery action.");
    // The database.json was uploaded straight to storage; read it from there.
    const [packageFile] = await claimUploads({ userId: access.id, purpose: "RESTORE_PACKAGE", uploadIds: [body.uploadId], keyPrefix: "backups/restore" });
    let backup: Record<string, unknown> | undefined;
    try {
      const object = await bucket.get(packageFile.key);
      backup = object?.body ? JSON.parse(await new Response(object.body).text()) : undefined;
    } catch {
      backup = undefined;
    } finally {
      await discardUploads([packageFile]); // never keep a full-data package around
    }
    const data = backup?.data as Record<string, unknown[]> | undefined;
    if (backup?.format !== "DOPS_RECOVERY_PACKAGE" || backup.schemaVersion !== 1 || !data || tables.some((table) => !Array.isArray(data[table]))) return jsonError("This is not a valid DOPS recovery package.");
    const admins = data.department_users as Record<string, unknown>[];
    const restoredAdmin = admins.find((row) => String(row.email).toLowerCase() === access.email.toLowerCase() && row.role === "ADMIN" && row.status === "ACTIVE");
    if (!restoredAdmin) return jsonError("Restore blocked: the package would remove your active administrator access.");
    // Identity is the email address (verified by OTP), so the restoring admin is
    // matched by email above. The legacy Supabase user_key is no longer used.
    const statements = [];
    // The audit log is append-only: a restore never deletes it (otherwise a
    // restore would erase the record of everything done after the backup).
    for (const table of [...restoreOrder].reverse()) if (table !== "audit_logs") statements.push(db.prepare(`DELETE FROM ${table}`));
    for (const table of restoreOrder) {
      if (table === "audit_logs") {
        // Add the package's entries only if not already present (e.g. restoring
        // onto a new server). New ids are assigned, so nothing is overwritten.
        const insertMissing = `INSERT INTO audit_logs (action,module,record_id,details,created_at)
          SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE created_at=? AND action=? AND module IS NOT DISTINCT FROM ? AND details IS NOT DISTINCT FROM ?)`;
        for (const raw of data.audit_logs as Record<string, unknown>[]) {
          const v = { action: raw.action ?? null, module: raw.module ?? null, record: raw.record_id ?? null, details: raw.details ?? null, at: raw.created_at ?? null };
          statements.push(db.prepare(insertMissing).bind(v.action, v.module, v.record, v.details, v.at, v.at, v.action, v.module, v.details));
        }
        continue;
      }
      const columns = tableColumns[table], placeholders = columns.map(() => "?").join(","), sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`;
      for (const raw of data[table] as Record<string, unknown>[]) statements.push(db.prepare(sql).bind(...columns.map((column) => raw[column] ?? null)));
    }
    for (const table of serialTables) statements.push(db.prepare(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM ${table}`));
    await db.batch(statements);
    await db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('RESTORE','ADMIN',NULL,?,?)").bind(actorDetails(access, "Database restored from verified recovery package"), now).run();
    // Restoring users deletes every session (auth_sessions cascades from
    // department_users) and may renumber user ids. Everyone else signs in
    // again; the admin who ran the restore gets a fresh session right away.
    const restoredSelf = await db.prepare("SELECT id FROM department_users WHERE lower(email)=? AND role='ADMIN' AND status='ACTIVE'").bind(access.email.toLowerCase()).first<{ id: number }>();
    if (restoredSelf) {
      // The admin was unlocked when running the restore; keep the new session unlocked too.
      const session = await createSession(Number(restoredSelf.id), "WEB");
      await unlockSession(session.sessionId);
    }
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof UploadError) return jsonError(error.message);
    console.error(error);
    return jsonError("Recovery action failed. Existing data may require administrator review.", 500);
  }
}
