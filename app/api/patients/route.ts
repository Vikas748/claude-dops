import { getDopsDb, jsonError, likePattern } from "@/lib/dops-db";
import { duplicateOpdMessage, isOpdNumberConflict, opdNumberOwner, readOpdNumber } from "@/lib/opd-number";
import { istDate, istYear } from "@/lib/dates";
import { isResponse, requirePermission } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requirePermission("OPD", "VIEW");
    if (isResponse(access)) return access;
    const db = getDopsDb();
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const like = likePattern(q);
    const result = await db
      .prepare(
        `SELECT p.id, p.patient_code AS patientCode, p.name, p.age, p.sex, p.mobile, p.address, p.opd_number AS opdNumber, o.id AS opdId, o.diagnosis, o.visit_date AS visitDate, o.status FROM patients p JOIN opd_visits o ON o.patient_id=p.id WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND (?='' OR p.name ILIKE ? OR p.patient_code ILIKE ? OR p.mobile ILIKE ? OR p.opd_number ILIKE ? OR o.diagnosis ILIKE ? OR o.visit_date ILIKE ?) ORDER BY o.visit_date DESC,o.id DESC LIMIT 200`,
      )
      .bind(q, like, like, like, like, like, like)
      .all();
    return Response.json({ success: true, data: result.results });
  } catch (error) {
    console.error("GET patients failed", error);
    return jsonError("Could not load patient records.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requirePermission("OPD", "CREATE");
    if (isResponse(access)) return access;
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 32 * 1024) ?? rateLimit(access, "opd-create", 30, 60_000);
    if (rejected) return rejected;
    const b = (await request.json()) as Record<string, unknown>;
    const name = String(b.name ?? "").trim();
    const age = Number(b.age);
    const sex = String(b.sex ?? "");
    const mobile = String(b.mobile ?? "").replace(/\D/g, "");
    const address = String(b.address ?? "").trim();
    const diagnosis = String(b.diagnosis ?? "").trim();
    if (
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
    const db = getDopsDb();
    const owner = await opdNumberOwner(opd.value);
    if (owner) return jsonError(duplicateOpdMessage(opd.value, owner), 409);
    const duplicate = await db
      .prepare(
        "SELECT patient_code AS patientCode FROM patients WHERE deleted_at IS NULL AND mobile=? AND lower(name)=lower(?) LIMIT 1",
      )
      .bind(mobile, name)
      .first<{ patientCode: string }>();
    if (duplicate)
      return jsonError(
        `Possible duplicate patient: ${duplicate.patientCode}. Search and review the existing record.`,
        409,
      );
    const now = new Date().toISOString();
    const draft = `PENDING-${crypto.randomUUID()}`;
    const inserted = await db
      .prepare(
        "INSERT INTO patients (patient_code,name,age,sex,mobile,address,opd_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
      )
      .bind(draft, name, age, sex, mobile, address, opd.value, now, now)
      .first<{ id: number }>();
    if (!inserted?.id) throw new Error("Patient insert returned no id");
    const code = `DOPS-${istYear()}-${String(inserted.id).padStart(6, "0")}`;
    const day = istDate(); // India date, not UTC
    await db.batch([
      db
        .prepare("UPDATE patients SET patient_code=? WHERE id=?")
        .bind(code, inserted.id),
      db
        .prepare(
          "INSERT INTO opd_visits (patient_id,diagnosis,visit_date,status,created_at,updated_at) VALUES (?,?,?,'OPD',?,?)",
        )
        .bind(inserted.id, diagnosis, day, now, now),
      db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('CREATE','OPD',?,?,?)",
        )
        .bind(inserted.id, actorDetails(access, `Registered ${code}`), now),
    ]);
    return Response.json(
      { success: true, data: { id: inserted.id, patientCode: code } },
      { status: 201 },
    );
  } catch (error) {
    if (isOpdNumberConflict(error)) return jsonError("This OPD No. / UHID No. is already used by another patient.", 409);
    console.error("POST patient failed", error);
    return jsonError("Patient registration failed.", 500);
  }
}
