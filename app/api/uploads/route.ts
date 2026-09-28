import { getDopsDb, jsonError } from "@/lib/dops-db";
import { isResponse, requirePermission } from "@/lib/access";
import { createUploadIntent, UploadError, type UploadPurpose } from "@/lib/uploads";
import { enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Step 1 of a direct upload: permission + validation, then a signed URL.
 * Body: { purpose, fileName, contentType, size, ...context }
 *   ACADEMIC:       { kind: CLASS | RESEARCH | PUBLICATION }
 *   OT_IMAGE:       { otId, imageType: PRE_OP | POST_OP }
 *   DISCHARGE_CARD: { wardId }
 */
export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 8 * 1024);
    if (rejected) return rejected;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const purpose = String(b.purpose ?? "") as UploadPurpose;
    const file = { fileName: String(b.fileName ?? ""), contentType: String(b.contentType ?? ""), size: Number(b.size) };
    const db = getDopsDb();
    let permModule: string, action: "CREATE" | "EDIT", keyPrefix: string;

    if (purpose === "ACADEMIC") {
      const kind = String(b.kind ?? "").toUpperCase();
      if (!["CLASS", "RESEARCH", "PUBLICATION"].includes(kind)) return jsonError("Invalid document type.");
      [permModule, action, keyPrefix] = [kind, "CREATE", `academic/${kind.toLowerCase()}`];
    } else if (purpose === "OT_IMAGE") {
      const otId = Number(b.otId), imageType = String(b.imageType ?? "").toUpperCase();
      if (!otId || !["PRE_OP", "POST_OP"].includes(imageType)) return jsonError("Choose a valid OT record and image category.");
      const ot = await db
        .prepare("SELECT p.patient_code AS \"patientCode\" FROM ot_procedures o JOIN ipd_admissions i ON i.id=o.ipd_id JOIN patients p ON p.id=i.patient_id WHERE o.id=?")
        .bind(otId)
        .first<{ patientCode: string }>();
      if (!ot) return jsonError("OT record not found.", 404);
      [permModule, action, keyPrefix] = ["OT", "CREATE", `patients/${ot.patientCode}/ot/${otId}/${imageType.toLowerCase()}`];
    } else if (purpose === "DISCHARGE_CARD") {
      const ward = await db
        .prepare("SELECT ipd_id AS \"ipdId\" FROM ward_stays WHERE id=? AND discharged_at IS NULL")
        .bind(Number(b.wardId))
        .first<{ ipdId: number }>();
      if (!ward) return jsonError("Active ward record not found.", 404);
      [permModule, action, keyPrefix] = ["WARD", "EDIT", `discharge/${ward.ipdId}`];
    } else {
      return jsonError("Invalid upload type.");
    }

    const access = await requirePermission(permModule, action);
    if (isResponse(access)) return access;
    const limited = rateLimit(access, "upload-sign", 60, 60_000);
    if (limited) return limited;

    const intent = await createUploadIntent({ userId: access.id, purpose, keyPrefix, ...file });
    return Response.json({ success: true, data: { uploadId: intent.uploadId, uploadUrl: intent.uploadUrl } });
  } catch (error) {
    if (error instanceof UploadError) return jsonError(error.message);
    console.error("Upload signing failed", error);
    return jsonError("File storage is temporarily unavailable. Try again shortly.", 503);
  }
}
