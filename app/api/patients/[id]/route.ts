import { getDopsDb, jsonError } from "@/lib/dops-db";
import { duplicateOpdMessage, isOpdNumberConflict, opdNumberOwner, readOpdNumber } from "@/lib/opd-number";
import { hasPermission, isResponse, requirePermission } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";

type TimelineEvent = {
  id: string;
  date: string;
  module: string;
  title: string;
  detail: string;
  status?: string;
};

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requirePermission("OPD", "VIEW");
    if (isResponse(access)) return access;
    const id = Number((await params).id);
    if (!id) return jsonError("Invalid patient.");
    const db = getDopsDb();
    const patient = await db
      .prepare(
        "SELECT id,patient_code AS patientCode,opd_number AS opdNumber,name,age,sex,mobile,address,created_at AS createdAt FROM patients WHERE id=? AND deleted_at IS NULL",
      )
      .bind(id)
      .first();
    if (!patient) return jsonError("Patient not found.", 404);

    const events: TimelineEvent[] = [];
    const opd = await db
      .prepare(
        "SELECT id,visit_date AS eventDate,diagnosis,status,created_at AS createdAt FROM opd_visits WHERE patient_id=? AND deleted_at IS NULL ORDER BY created_at",
      )
      .bind(id)
      .all<Record<string, unknown>>();
    for (const row of opd.results)
      events.push({
        id: `opd-${row.id}`,
        date: String(row.createdAt || row.eventDate),
        module: "OPD",
        title: "OPD registration",
        detail: String(row.diagnosis),
        status: String(row.status),
      });

    if (hasPermission(access, "IPD", "VIEW")) {
      const admissions = await db
        .prepare(
          "SELECT id,admission_date AS eventDate,diagnosis,plan_management AS planManagement,ayushman_code AS ayushmanCode,status,created_at AS createdAt FROM ipd_admissions WHERE patient_id=? ORDER BY created_at",
        )
        .bind(id)
        .all<Record<string, unknown>>();
      for (const row of admissions.results) {
        events.push({
          id: `ipd-${row.id}`,
          date: String(row.createdAt || row.eventDate),
          module: "IPD",
          title: "IPD admission",
          detail: [row.diagnosis, row.planManagement]
            .filter(Boolean)
            .map(String)
            .join(" · "),
          status: String(row.status),
        });

        if (hasPermission(access, "WARD", "VIEW")) {
          const ward = await db
            .prepare(
              "SELECT id,ward_name AS wardName,bed_number AS bedNumber,pac_status AS pacStatus,admitted_at AS admittedAt,discharged_at AS dischargedAt,updated_at AS updatedAt FROM ward_stays WHERE ipd_id=?",
            )
            .bind(Number(row.id))
            .first<Record<string, unknown>>();
          if (ward) {
            events.push({
              id: `ward-${ward.id}`,
              date: String(ward.admittedAt),
              module: "WARD",
              title: "Moved to ward",
              detail: `${ward.wardName}, bed ${ward.bedNumber}`,
              status: String(ward.pacStatus),
            });
            if (ward.pacStatus !== "PENDING")
              events.push({
                id: `pac-${ward.id}`,
                date: String(ward.updatedAt),
                module: "PAC",
                title: `PAC ${String(ward.pacStatus).toLowerCase()}`,
                detail: "Pre-anesthesia fitness updated",
                status: String(ward.pacStatus),
              });
          }
        }

        if (hasPermission(access, "OT", "VIEW")) {
          const procedures = await db
            .prepare(
              "SELECT id,scheduled_date AS scheduledDate,scheduled_time AS scheduledTime,procedure_name AS procedureName,surgeon_name AS surgeonName,pac_status AS pacStatus,status,created_at AS createdAt FROM ot_procedures WHERE ipd_id=? ORDER BY scheduled_date,scheduled_time",
            )
            .bind(Number(row.id))
            .all<Record<string, unknown>>();
          for (const ot of procedures.results)
            events.push({
              id: `ot-${ot.id}`,
              date: `${ot.scheduledDate}T${ot.scheduledTime || "00:00"}:00`,
              module: "OT",
              title: String(ot.procedureName),
              detail: `Surgeon: ${ot.surgeonName}`,
              status: String(ot.status),
            });
        }

        if (hasPermission(access, "WARD", "VIEW")) {
          const discharge = await db
            .prepare(
              "SELECT id,discharge_date AS dischargeDate,notes,card_name AS cardName,created_at AS createdAt FROM discharge_records WHERE ipd_id=?",
            )
            .bind(Number(row.id))
            .first<Record<string, unknown>>();
          if (discharge)
            events.push({
              id: `discharge-${discharge.id}`,
              date: String(discharge.createdAt || discharge.dischargeDate),
              module: "DISCHARGE",
              title: "Patient discharged",
              detail: String(discharge.notes || discharge.cardName || "Discharge completed"),
              status: "COMPLETED",
            });
        }
      }
    }

    if (hasPermission(access, "CM_HELPLINE", "VIEW")) {
      const helpline = await db
        .prepare(
          "SELECT id,record_date AS recordDate,status,payload,created_at AS createdAt FROM special_records WHERE kind='HELPLINE' AND patient_id=? AND deleted_at IS NULL ORDER BY created_at",
        )
        .bind(id)
        .all<Record<string, unknown>>();
      for (const row of helpline.results) {
        let detail = "CM Helpline case";
        try {
          const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
          detail = String(payload.Description || payload.Diagnosis || detail);
        } catch {}
        events.push({
          id: `helpline-${row.id}`,
          date: String(row.createdAt || row.recordDate),
          module: "CM HELPLINE",
          title: "CM Helpline case added",
          detail,
          status: String(row.status),
        });
      }
    }

    events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    return Response.json({ success: true, data: { patient, events } });
  } catch (error) {
    console.error("GET patient timeline failed", error);
    return jsonError("Could not load patient timeline.", 500);
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requirePermission("OPD", "EDIT");
    if (isResponse(access)) return access;
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 32 * 1024) ?? rateLimit(access, "opd-edit", 40, 60_000);
    if (rejected) return rejected;
    const id = Number((await params).id),
      b = (await request.json()) as Record<string, unknown>,
      name = String(b.name ?? "").trim(),
      age = Number(b.age),
      sex = String(b.sex ?? ""),
      mobile = String(b.mobile ?? "").replace(/\D/g, ""),
      address = String(b.address ?? "").trim(),
      diagnosis = String(b.diagnosis ?? "").trim();
    if (
      !id ||
      !name ||
      !Number.isInteger(age) ||
      age < 0 ||
      age > 120 ||
      !["Male", "Female", "Other"].includes(sex) ||
      mobile.length !== 10 ||
      !address ||
      !diagnosis
    )
      return jsonError("Please enter valid patient details.");
    const opd = readOpdNumber(b.opdNumber);
    if ("error" in opd) return jsonError(opd.error);
    const opdNumber = opd.value;
    const owner = await opdNumberOwner(opdNumber, id);
    if (owner) return jsonError(duplicateOpdMessage(opdNumber, owner), 409);
    const db = getDopsDb(),
      now = new Date().toISOString(),
      visit = await db
        .prepare(
          "SELECT id FROM opd_visits WHERE patient_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
        )
        .bind(id)
        .first<{ id: number }>();
    if (!visit) return jsonError("Patient record not found.", 404);
    const before = await db
      .prepare("SELECT p.name,p.age,p.sex,p.mobile,p.address,p.opd_number AS \"opdNumber\",o.diagnosis FROM patients p JOIN opd_visits o ON o.id=? WHERE p.id=?")
      .bind(visit.id, id)
      .first<{ name: string; age: number; sex: string; mobile: string; address: string; opdNumber: string | null; diagnosis: string }>();
    const after = { name, age, sex, mobile, address, opdNumber, diagnosis };
    const labels: Record<string, string> = { name: "name", age: "age", sex: "sex", mobile: "mobile", address: "address", opdNumber: "OPD No./UHID No.", diagnosis: "diagnosis" };
    const changed = before ? Object.keys(after).filter((k) => String(before[k as keyof typeof before]) !== String(after[k as keyof typeof after])).map((k) => labels[k]) : [];
    await db.batch([
      db
        .prepare(
          "UPDATE patients SET name=?,age=?,sex=?,mobile=?,address=?,opd_number=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
        )
        .bind(name, age, sex, mobile, address, opdNumber, now, id),
      db
        .prepare("UPDATE opd_visits SET diagnosis=?,updated_at=? WHERE id=?")
        .bind(diagnosis, now, visit.id),
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('UPDATE','OPD',?,?,?)",
        )
        .bind(id, actorDetails(access, `Patient details edited: ${changed.join(", ") || "no changes"}`), now),
    ]);
    return Response.json({ success: true });
  } catch (error) {
    if (isOpdNumberConflict(error)) return jsonError("This OPD No. / UHID No. is already used by another patient.", 409);
    console.error("PATCH patient failed", error);
    return jsonError("Patient update failed.", 500);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requirePermission("OPD", "DELETE");
    if (isResponse(access)) return access;
    const rejected = rejectCrossSiteMutation(request) ?? rateLimit(access, "opd-delete", 15, 60_000);
    if (rejected) return rejected;
    const id = Number((await params).id);
    if (!id) return jsonError("Invalid patient.");
    const db = getDopsDb(),
      now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "UPDATE patients SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
        )
        .bind(now, now, id),
      db
        .prepare(
          "UPDATE opd_visits SET deleted_at=?,updated_at=? WHERE patient_id=? AND deleted_at IS NULL",
        )
        .bind(now, now, id),
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('DELETE','OPD',?,?,?)",
        )
        .bind(id, actorDetails(access, "Patient soft-deleted"), now),
    ]);
    return Response.json({ success: true });
  } catch (error) {
    console.error("DELETE patient failed", error);
    return jsonError("Could not remove patient.", 500);
  }
}
