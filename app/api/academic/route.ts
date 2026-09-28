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
export async function POST(request: Request) {
  try {
    // The PDF is already in storage (uploaded directly via /api/uploads);
    // this request only carries the details and the uploadId.
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>,
      kind = String(b.kind ?? "").toUpperCase(),
      title = String(b.title ?? "").trim(),
      doctor = String(b.doctorName ?? "").trim(),
      date = String(b.documentDate ?? ""),
      external = String(b.externalUrl ?? "").trim() || null;
    if (!["CLASS", "RESEARCH", "PUBLICATION"].includes(kind) || !title || !doctor || !date || !b.uploadId)
      return jsonError("Complete all required fields and select a PDF.");
    const access=await requirePermission(kind, "CREATE");if(isResponse(access))return access;
    const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,32*1024)??rateLimit(access,"academic-upload",15,60_000);if(rejected)return rejected;
    if (external) {
      try {
        const u = new URL(external);
        if (!["http:", "https:"].includes(u.protocol)) throw 0;
      } catch {
        return jsonError("Enter a valid external link.");
      }
    }
    const [file] = await claimUploads({ userId: access.id, purpose: "ACADEMIC", uploadIds: [b.uploadId], keyPrefix: `academic/${kind.toLowerCase()}` });
    const db = getDopsDb(),
      now = new Date().toISOString();
    const row = await db
      .prepare(
        "INSERT INTO academic_documents (kind,title,doctor_name,document_date,file_key,file_name,external_url,created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
      )
      .bind(kind, title, doctor, date, file.key, file.fileName, external, now)
      .first<{ id: number }>()
      .catch(async (error) => { await discardUploads([file]); throw error; });
    await db
      .prepare(
        "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('CREATE',?,?,?,?)",
      )
        .bind(kind, row?.id ?? null, actorDetails(access,title), now)
      .run();
    return Response.json({ success: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return jsonError(e.message);
    console.error(e);
    return jsonError("Document upload failed.", 500);
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
