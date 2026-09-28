import { getDopsBucket, getDopsDb, jsonError } from "@/lib/dops-db";
import { claimUploads, discardUploads, UploadError, type ClaimedUpload } from "@/lib/uploads";
import { isResponse, requirePermission } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";
export const dynamic = "force-dynamic";
// Type and size limits live in UPLOAD_RULES (lib/uploads.ts).
const maxFiles = 6;

export async function GET(request: Request) {
  try {
    const access = await requirePermission("OT", "VIEW");
    if (isResponse(access)) return access;
    const otId = Number(new URL(request.url).searchParams.get("otId"));
    if (!otId) return jsonError("Invalid OT record.");
    const db = getDopsDb(),
      ot = await db
        .prepare("SELECT id FROM ot_procedures WHERE id=?")
        .bind(otId)
        .first();
    if (!ot) return jsonError("OT record not found.", 404);
    const rows = await db
      .prepare(
        "SELECT id,image_type AS imageType,file_key AS fileKey,file_name AS fileName,mime_type AS mimeType,size_bytes AS sizeBytes,created_at AS createdAt FROM ot_images WHERE ot_id=? AND deleted_at IS NULL ORDER BY image_type,created_at,id",
      )
      .bind(otId)
      .all();
    return Response.json({ success: true, data: rows.results });
  } catch (e) {
    console.error(e);
    return jsonError("Could not load OT images.", 503);
  }
}

export async function POST(request: Request) {
  // Images are already in storage (uploaded directly via /api/uploads);
  // this request carries { otId, imageType, uploadIds }.
  let claimed: ClaimedUpload[] = [];
  try {
    const access = await requirePermission("OT", "CREATE");
    if (isResponse(access)) return access;
    const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,16*1024)??rateLimit(access,"ot-image-upload",12,60_000);if(rejected)return rejected;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>,
      otId = Number(b.otId),
      imageType = String(b.imageType ?? "").toUpperCase(),
      uploadIds = Array.isArray(b.uploadIds) ? b.uploadIds : [];
    if (!otId || !["PRE_OP", "POST_OP"].includes(imageType))
      return jsonError("Choose a valid OT record and image category.");
    if (!uploadIds.length || uploadIds.length > maxFiles)
      return jsonError(`Select 1 to ${maxFiles} images.`);
    const db = getDopsDb(),
      ot = await db
        .prepare(
          "SELECT o.id,p.patient_code AS patientCode FROM ot_procedures o JOIN ipd_admissions i ON i.id=o.ipd_id JOIN patients p ON p.id=i.patient_id WHERE o.id=?",
        )
        .bind(otId)
        .first<{ id: number; patientCode: string }>();
    if (!ot) return jsonError("OT record not found.", 404);
    const existing = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM ot_images WHERE ot_id=? AND image_type=? AND deleted_at IS NULL",
      )
      .bind(otId, imageType)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) + uploadIds.length > 12)
      return jsonError("Maximum 12 images are allowed in each category.");
    claimed = await claimUploads({
      userId: access.id,
      purpose: "OT_IMAGE",
      uploadIds,
      keyPrefix: `patients/${ot.patientCode}/ot/${otId}/${imageType.toLowerCase()}`,
    });
    const now = new Date().toISOString(),
      statements = claimed.map((file) =>
        db
          .prepare(
            "INSERT INTO ot_images (ot_id,image_type,file_key,file_name,mime_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(otId, imageType, file.key, file.fileName, file.contentType, file.size, now),
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('UPLOAD','OT',?,?,?)",
        )
        .bind(
          otId,
          actorDetails(access,`${claimed.length} ${imageType.replace("_", "-")} image(s) uploaded`),
          now,
        ),
    );
    await db.batch(statements);
    return Response.json(
      { success: true, data: { uploaded: claimed.length } },
      { status: 201 },
    );
  } catch (e) {
    // Files verified in this request but not saved: remove them.
    await discardUploads(claimed);
    if (e instanceof UploadError) return jsonError(e.message);
    console.error(e);
    return jsonError("OT image upload failed.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await requirePermission("OT", "DELETE");
    if (isResponse(access)) return access;
    const rejected=rejectCrossSiteMutation(request)??rateLimit(access,"ot-image-delete",20,60_000);if(rejected)return rejected;
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return jsonError("Invalid image.");
    const db = getDopsDb(),
      row = await db
        .prepare(
          "SELECT ot_id AS otId,file_key AS fileKey FROM ot_images WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .first<{ otId: number; fileKey: string }>();
    if (!row) return jsonError("Image not found.", 404);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE ot_images SET deleted_at=? WHERE id=?").bind(now, id),
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('DELETE','OT',?,?,?)",
        )
        .bind(row.otId, actorDetails(access,"OT image removed"), now),
    ]);
    await getDopsBucket().delete(row.fileKey);
    return Response.json({ success: true });
  } catch (e) {
    console.error(e);
    return jsonError("Could not remove OT image.", 500);
  }
}
