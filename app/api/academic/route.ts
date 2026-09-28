import { getDopsDb, jsonError, likePattern } from "@/lib/dops-db";
import { claimUploads, discardUploads, UploadError } from "@/lib/uploads";
import { isResponse, requirePermission } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const db = getDopsDb(),
      u = new URL(request.url),
      kind = (u.searchParams.get("kind") ?? "").toUpperCase(),
      q = (u.searchParams.get("q") ?? "").trim(),
      like = likePattern(q);
    if (!["CLASS", "RESEARCH", "PUBLICATION"].includes(kind))
      return jsonError("Invalid academic module.");
    const access=await requirePermission(kind, "VIEW");if(isResponse(access))return access;
    const r = await db
      .prepare(
        "SELECT id,kind,title,doctor_name AS doctorName,document_date AS documentDate,file_key AS fileKey,file_name AS fileName,external_url AS externalUrl FROM academic_documents WHERE kind=? AND deleted_at IS NULL AND (?='' OR title ILIKE ? OR doctor_name ILIKE ? OR document_date ILIKE ?) ORDER BY document_date DESC,id DESC",
      )
      .bind(kind, q, like, like, like)
      .all();
    return Response.json({ success: true, data: r.results });
  } catch (e) {
    console.error(e);
    return jsonError("Could not load documents.", 503);
  }
}
type Details = { kind: string; title: string; doctor: string; date: string; external: string | null };

/** Validates the document details shared by create and edit. */
function readDetails(b: Record<string, unknown>): Details | Response {
  const kind = String(b.kind ?? "").toUpperCase(),
    title = String(b.title ?? "").trim(),
    doctor = String(b.doctorName ?? "").trim(),
    date = String(b.documentDate ?? ""),
    external = String(b.externalUrl ?? "").trim() || null;
  if (!["CLASS", "RESEARCH", "PUBLICATION"].includes(kind) || !title || !doctor || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return jsonError("Complete the title, doctor name and date.");
  if (title.length > 300 || doctor.length > 150) return jsonError("Title or doctor name is too long.");
  if (external) {
    try {
      const u = new URL(external);
      if (!["http:", "https:"].includes(u.protocol)) throw 0;
    } catch {
      return jsonError("Enter a valid external link.");
    }
  }
  return { kind, title, doctor, date, external };
}

/**
 * Create a Class / Research / Publication entry. The PDF is optional: it can
 * be attached now (uploadId from /api/uploads) or later with PATCH.
 */
export async function POST(request: Request) {
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const d = readDetails(b);
    if (d instanceof Response) return d;
    const access = await requirePermission(d.kind, "CREATE");
    if (isResponse(access)) return access;
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 32 * 1024) ?? rateLimit(access, "academic-upload", 15, 60_000);
    if (rejected) return rejected;
    const file = b.uploadId
      ? (await claimUploads({ userId: access.id, purpose: "ACADEMIC", uploadIds: [b.uploadId], keyPrefix: `academic/${d.kind.toLowerCase()}` }))[0]
      : null;
    const db = getDopsDb(),
      now = new Date().toISOString();
    const row = await db
      .prepare(
        "INSERT INTO academic_documents (kind,title,doctor_name,document_date,file_key,file_name,external_url,created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
      )
      .bind(d.kind, d.title, d.doctor, d.date, file?.key ?? null, file?.fileName ?? null, d.external, now)
      .first<{ id: number }>()
      .catch(async (error) => {
        if (file) await discardUploads([file]);
        throw error;
      });
    await db
      .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('CREATE',?,?,?,?)")
      .bind(d.kind, row?.id ?? null, actorDetails(access, `${d.title}${file ? " (with PDF)" : " (no PDF yet)"}`), now)
      .run();
    return Response.json({ success: true, data: { id: row?.id } }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return jsonError(e.message);
    console.error(e);
    return jsonError("Could not save the document.", 500);
  }
}

/**
 * Edit an entry: change its details and/or attach or replace the PDF.
 * Body: { id, kind, title, doctorName, documentDate, externalUrl?, uploadId? }
 */
export async function PATCH(request: Request) {
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = Number(b.id);
    if (!id) return jsonError("Invalid document.");
    const d = readDetails(b);
    if (d instanceof Response) return d;
    const db = getDopsDb();
    const current = await db
      .prepare(
        `SELECT kind, title, doctor_name AS "doctor", document_date AS "date", external_url AS "external", file_key AS "fileKey"
           FROM academic_documents WHERE id=? AND deleted_at IS NULL`,
      )
      .bind(id)
      .first<{ kind: string; title: string; doctor: string; date: string; external: string | null; fileKey: string | null }>();
    if (!current) return jsonError("Document not found.", 404);
    if (current.kind !== d.kind) return jsonError("The document type cannot be changed.");
    const access = await requirePermission(d.kind, "EDIT");
    if (isResponse(access)) return access;
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 32 * 1024) ?? rateLimit(access, "academic-edit", 30, 60_000);
    if (rejected) return rejected;
    const file = b.uploadId
      ? (await claimUploads({ userId: access.id, purpose: "ACADEMIC", uploadIds: [b.uploadId], keyPrefix: `academic/${d.kind.toLowerCase()}` }))[0]
      : null;
    const now = new Date().toISOString();
    const changed = [
      current.title !== d.title && "title",
      current.doctor !== d.doctor && "doctor name",
      current.date !== d.date && "date",
      (current.external ?? null) !== d.external && "external link",
      file && (current.fileKey ? "PDF replaced" : "PDF added"),
    ].filter(Boolean);
    try {
      await db.batch([
        file
          ? db
              .prepare("UPDATE academic_documents SET title=?,doctor_name=?,document_date=?,external_url=?,file_key=?,file_name=? WHERE id=? AND deleted_at IS NULL")
              .bind(d.title, d.doctor, d.date, d.external, file.key, file.fileName, id)
          : db
              .prepare("UPDATE academic_documents SET title=?,doctor_name=?,document_date=?,external_url=? WHERE id=? AND deleted_at IS NULL")
              .bind(d.title, d.doctor, d.date, d.external, id),
        db
          .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('UPDATE',?,?,?,?)")
          .bind(d.kind, id, actorDetails(access, `${d.title}: ${changed.join(", ") || "no changes"}`), now),
      ]);
    } catch (error) {
      if (file) await discardUploads([file]);
      throw error;
    }
    // A replaced PDF is kept in storage (like soft-deleted records), so older
    // recovery backups that still point to it can be restored completely.
    return Response.json({ success: true });
  } catch (e) {
    if (e instanceof UploadError) return jsonError(e.message);
    console.error(e);
    return jsonError("Could not update the document.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return jsonError("Invalid document.");
    const db = getDopsDb(),
      now = new Date().toISOString();
    const record=await db.prepare("SELECT kind FROM academic_documents WHERE id=? AND deleted_at IS NULL").bind(id).first<{kind:string}>();if(!record)return jsonError("Document not found.",404);const access=await requirePermission(record.kind, "DELETE");if(isResponse(access))return access;
    const rejected=rejectCrossSiteMutation(request)??rateLimit(access,"academic-delete",15,60_000);if(rejected)return rejected;
    await db.batch([
      db
        .prepare(
          "UPDATE academic_documents SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
        )
        .bind(now, id),
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('DELETE','ACADEMIC',?,?,?)",
        )
        .bind(id, actorDetails(access,"Document removed"), now),
    ]);
    return Response.json({ success: true });
  } catch (e) {
    console.error(e);
    return jsonError("Could not remove document.", 500);
  }
}
