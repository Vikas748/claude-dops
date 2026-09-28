import { getDopsDb, jsonError } from "@/lib/dops-db";
import { istDate } from "@/lib/dates";
import { isResponse, requirePermission } from "@/lib/access";
import { actorDetails, rateLimit, rejectCrossSiteMutation } from "@/lib/security";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access=await requirePermission("IPD", "CREATE");if(isResponse(access))return access;
    const rejected=rejectCrossSiteMutation(request)??rateLimit(access,"ipd-admit",20,60_000);if(rejected)return rejected;
    const opdId = Number((await params).id);
    if (!opdId) return jsonError("Invalid OPD record.");
    const db = getDopsDb();
    const visit = await db
      .prepare(
        "SELECT patient_id AS patientId,diagnosis,status FROM opd_visits WHERE id=? AND deleted_at IS NULL",
      )
      .bind(opdId)
      .first<{ patientId: number; diagnosis: string; status: string }>();
    if (!visit) return jsonError("OPD record not found.", 404);
    if (visit.status === "ADMITTED")
      return jsonError("Patient is already admitted.", 409);
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO ipd_admissions (patient_id,opd_visit_id,diagnosis,admission_date,status,created_at,updated_at) VALUES (?,?,?,?,'ADMITTED',?,?)",
        )
        .bind(
          visit.patientId,
          opdId,
          visit.diagnosis,
          istDate(),
          now,
          now,
        ),
      db
        .prepare(
          "UPDATE opd_visits SET status='ADMITTED',updated_at=? WHERE id=?",
        )
        .bind(now, opdId),
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('ADMIT','IPD',?,?,?)",
        )
        .bind(visit.patientId, actorDetails(access,"Admitted from OPD"), now),
    ]);
    return Response.json({ success: true });
  } catch (error) {
    console.error("Admit patient failed", error);
    return jsonError("Could not admit patient.", 500);
  }
}
