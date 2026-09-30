import { getDopsDb, jsonError, type DopsDatabase } from "@/lib/dops-db";
import { istDate } from "@/lib/dates";
import { claimUploads, discardUploads, UploadError, type ClaimedUpload } from "@/lib/uploads";
import { getDopsAccess, hasPermission, isResponse, requirePermission } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";
/** How a patient can leave the ward. */
const WARD_EXIT = ["DISCHARGED", "LAMA", "DOR", "DAMA"];

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access=await getDopsAccess();if(isResponse(access))return access;
    if(!["IPD","WARD","OT"].some(module=>hasPermission(access,module,"VIEW")))return jsonError("Clinical module access required.",403);
    const db = getDopsDb();
    const [ipd, ward, ot] = await Promise.all([
      db
        .prepare(
          `SELECT i.id,i.patient_id AS patientId,i.diagnosis,i.admission_date AS admissionDate,i.plan_management AS planManagement,i.ayushman_code AS ayushmanCode,i.case_category AS caseCategory,i.status,p.patient_code AS patientCode,p.opd_number AS opdNumber,p.name,p.age,p.sex,p.mobile FROM ipd_admissions i JOIN patients p ON p.id=i.patient_id WHERE p.deleted_at IS NULL ORDER BY i.id DESC`,
        )
        .all(),
      db
        .prepare(
          `SELECT w.id AS wardId,w.ipd_id AS ipdId,w.ward_name AS wardName,w.bed_number AS bedNumber,w.pac_status AS pacStatus,w.admitted_at AS admittedAt,w.discharged_at AS dischargedAt,w.discharge_status AS dischargeStatus,i.case_category AS caseCategory,i.diagnosis,p.patient_code AS patientCode,p.opd_number AS opdNumber,p.name,p.age,p.sex FROM ward_stays w JOIN ipd_admissions i ON i.id=w.ipd_id JOIN patients p ON p.id=i.patient_id ORDER BY w.id DESC`,
        )
        .all(),
      db
        .prepare(
          `SELECT o.id,o.ipd_id AS ipdId,o.scheduled_date AS scheduledDate,o.scheduled_time AS scheduledTime,o.procedure_name AS procedureName,o.surgeon_name AS surgeonName,o.pac_status AS pacStatus,o.status,i.diagnosis,p.patient_code AS patientCode,p.opd_number AS opdNumber,p.name FROM ot_procedures o JOIN ipd_admissions i ON i.id=o.ipd_id JOIN patients p ON p.id=i.patient_id ORDER BY o.scheduled_date DESC,o.scheduled_time DESC`,
        )
        .all(),
    ]);
    return Response.json({
      success: true,
      data: { ipd: hasPermission(access,"IPD","VIEW")?ipd.results:[], ward: hasPermission(access,"WARD","VIEW")?ward.results:[], ot: hasPermission(access,"OT","VIEW")?ot.results:[] },
    });
  } catch (e) {
    console.error("clinical GET failed", e);
    return jsonError("Could not load clinical records.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const b = (await request.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    if (action === "discharge") {
      const access=await requirePermission("WARD", "EDIT");if(isResponse(access))return access;
      const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,32*1024)??rateLimit(access,"discharge",12,60_000);if(rejected)return rejected;
      return discharge(b, access);
    }
    const permissionModule=action==="update_ipd"||action==="case_category"?"IPD":action==="schedule_ot"||action==="ot_status"?"OT":"WARD";
    const permissionAction=action==="schedule_ot"||action==="move_ward"?"CREATE":"EDIT";
    const access=await requirePermission(permissionModule, permissionAction);if(isResponse(access))return access;
    const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,64*1024)??rateLimit(access,"clinical-action",50,60_000);if(rejected)return rejected;
    const db = getDopsDb(),
      now = new Date().toISOString();
    if (action === "case_category") {
      // IPD "CASE CATEGORY": MLC or NON-MLC (shown in IPD and Ward)
      const id = Number(b.id), category = String(b.category ?? "").toUpperCase();
      if (!id || !["MLC", "NON-MLC", ""].includes(category)) return jsonError("Choose MLC or NON-MLC.");
      const row = await db.prepare("UPDATE ipd_admissions SET case_category=?,updated_at=? WHERE id=? RETURNING id").bind(category || null, now, id).first();
      if (!row) return jsonError("IPD record not found.", 404);
      await audit(db, access, "UPDATE", "IPD", id, `Case category: ${category || "not set"}`, now).run();
      return Response.json({ success: true });
    }
    if (action === "ward_status") {
      // Change how a patient left the ward (after discharge): DISCHARGED / LAMA / DOR / DAMA
      const wardId = Number(b.wardId), status = String(b.status ?? "").toUpperCase();
      if (!wardId || !WARD_EXIT.includes(status)) return jsonError("Choose DISCHARGED, LAMA, DOR or DAMA.");
      const row = await db.prepare("UPDATE ward_stays SET discharge_status=?,updated_at=? WHERE id=? AND discharged_at IS NOT NULL RETURNING ipd_id AS \"ipdId\"").bind(status, now, wardId).first<{ ipdId: number }>();
      if (!row) return jsonError("Only a patient who has left the ward has this status.", 404);
      await audit(db, access, "UPDATE", "WARD", row.ipdId, `Ward status changed to ${status}`, now).run();
      return Response.json({ success: true });
    }
    if (action === "update_ipd") {
      const id = Number(b.id),
        plan = String(b.planManagement ?? "").trim(),
        code = String(b.ayushmanCode ?? "").trim();
      await db.batch([
        db
          .prepare(
            "UPDATE ipd_admissions SET plan_management=?,ayushman_code=?,updated_at=? WHERE id=?",
          )
          .bind(plan, code, now, id),
        audit(db, access, "UPDATE", "IPD", id, "Management plan updated", now),
      ]);
      return Response.json({ success: true });
    }
    if (action === "move_ward") {
      const id = Number(b.id),
        ward = String(b.wardName ?? "").trim(),
        bed = String(b.bedNumber ?? "").trim();
      if (!id || !ward || !bed) return jsonError("Ward and bed are required.");
      await db.batch([
        db
          .prepare(
            "INSERT INTO ward_stays (ipd_id,ward_name,bed_number,pac_status,admitted_at,updated_at) VALUES (?,?,?,'PENDING',?,?)",
          )
          .bind(id, ward, bed, now, now),
        db
          .prepare(
            "UPDATE ipd_admissions SET status='IN_WARD',updated_at=? WHERE id=? AND status='ADMITTED'",
          )
          .bind(now, id),
        audit(db, access, "TRANSFER", "WARD", id, `${ward}, bed ${bed}`, now),
      ]);
      return Response.json({ success: true });
    }
    if (action === "pac") {
      const id = Number(b.id),
        status = String(b.status ?? "");
      if (!["PENDING", "FIT", "UNFIT"].includes(status))
        return jsonError("Invalid PAC status.");
      const row = await db
        .prepare(
          "SELECT ipd_id AS ipdId FROM ward_stays WHERE id=? AND discharged_at IS NULL",
        )
        .bind(id)
        .first<{ ipdId: number }>();
      if (!row) return jsonError("Active ward record not found.", 404);
      await db.batch([
        db
          .prepare("UPDATE ward_stays SET pac_status=?,updated_at=? WHERE id=?")
          .bind(status, now, id),
        db
          .prepare(
            "UPDATE ot_procedures SET pac_status=?,updated_at=? WHERE ipd_id=? AND status='SCHEDULED'",
          )
          .bind(status, now, row.ipdId),
        audit(db, access, "PAC", "WARD", id, `PAC ${status}`, now),
      ]);
      return Response.json({ success: true });
    }
    if (action === "schedule_ot") {
      const id = Number(b.id),
        date = String(b.scheduledDate ?? ""),
        time = String(b.scheduledTime ?? ""),
        procedure = String(b.procedureName ?? "").trim(),
        surgeon = String(b.surgeonName ?? "").trim();
      if (!id || !date || !time || !procedure || !surgeon)
        return jsonError("Complete all OT fields.");
      // Stored as text and sorted as text, so the format must be exact.
      const parsed = new Date(`${date}T00:00:00Z`);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
      if (!validDate) return jsonError("Enter a valid OT date.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return jsonError("Enter the OT time as HH:MM (24-hour).");
      const ward = await db
        .prepare(
          "SELECT pac_status AS pac FROM ward_stays WHERE ipd_id=? AND discharged_at IS NULL",
        )
        .bind(id)
        .first<{ pac: string }>();
      await db.batch([
        db
          .prepare(
            "INSERT INTO ot_procedures (ipd_id,scheduled_date,scheduled_time,procedure_name,surgeon_name,pac_status,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'SCHEDULED',?,?)",
          )
          .bind(
            id,
            date,
            time,
            procedure,
            surgeon,
            ward?.pac ?? "PENDING",
            now,
            now,
          ),
        audit(db, access, "SCHEDULE", "OT", id, `${procedure} on ${date}`, now),
      ]);
      return Response.json({ success: true });
    }
    if (action === "ot_status") {
      const id = Number(b.id),
        status = String(b.status ?? "");
      if (!["COMPLETED", "CANCELLED", "POSTPONED"].includes(status))
        return jsonError("Invalid OT status.");
      await db.batch([
        db
          .prepare("UPDATE ot_procedures SET status=?,updated_at=? WHERE id=?")
          .bind(status, now, id),
        audit(db, access, "STATUS", "OT", id, status, now),
      ]);
      return Response.json({ success: true });
    }
    return jsonError("Unsupported clinical action.");
  } catch (e) {
    console.error("clinical POST failed", e);
    return jsonError(
      e instanceof Error && e.message.includes("UNIQUE")
        ? "This patient is already in the ward."
        : "Clinical action failed.",
      500,
    );
  }
}

async function discharge(b: Record<string, unknown>, access: Awaited<ReturnType<typeof getDopsAccess>> & { id: number; role: string }) {
  const db = getDopsDb(),
    now = new Date().toISOString(),
    wardId = Number(b.wardId),
    notes = String(b.notes ?? "").trim(),
    exitStatus = String(b.status ?? "DISCHARGED").toUpperCase();
  if (!WARD_EXIT.includes(exitStatus)) return jsonError("Choose DISCHARGED, LAMA, DOR or DAMA.");
  const row = await db
    .prepare(
      "SELECT ipd_id AS ipdId FROM ward_stays WHERE id=? AND discharged_at IS NULL",
    )
    .bind(wardId)
    .first<{ ipdId: number }>();
  if (!row) return jsonError("Active ward record not found.", 404);
  // Optional discharge card, already uploaded directly to storage via /api/uploads.
  let card: ClaimedUpload | null = null;
  if (b.uploadId) {
    try {
      [card] = await claimUploads({ userId: access.id, purpose: "DISCHARGE_CARD", uploadIds: [b.uploadId], keyPrefix: `discharge/${row.ipdId}` });
    } catch (error) {
      if (error instanceof UploadError) return jsonError(error.message);
      throw error;
    }
  }
  try {
    await db.batch([
      db
        .prepare("UPDATE ward_stays SET discharged_at=?,discharge_status=?,updated_at=? WHERE id=?")
        .bind(now, exitStatus, now, wardId),
      db
        .prepare(
          "UPDATE ipd_admissions SET status='DISCHARGED',updated_at=? WHERE id=?",
        )
        .bind(now, row.ipdId),
      db
        .prepare(
          "INSERT INTO discharge_records (ipd_id,discharge_date,notes,card_key,card_name,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(row.ipdId, istDate(), notes, card?.key ?? null, card?.fileName ?? null, now),
      audit(db, access, "DISCHARGE", "WARD", row.ipdId, `Patient left the ward: ${exitStatus}`, now),
    ]);
  } catch (error) {
    if (card) await discardUploads([card]);
    throw error;
  }
  return Response.json({ success: true });
}
function audit(
  db: DopsDatabase,
  access: { id: number; role: string },
  action: string,
  module: string,
  id: number,
  details: string,
  now: string,
) {
  return db
    .prepare(
      "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(action, module, id, actorDetails(access,details), now);
}
