import { getDopsDb, jsonError, likePattern } from "@/lib/dops-db";
import { formatDate, istDate } from "@/lib/dates";
import { isResponse, requirePermission } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation, csvCell } from "@/lib/security";
import { buildXlsx } from "@/lib/xlsx";
import { decryptPayload, encryptPayload, EncryptionConfigError, isSensitiveField, looksMasked, maskPayload } from "@/lib/field-crypto";
export const dynamic = "force-dynamic";
const kinds = ["SKIN_RECIPIENT", "SKIN_DONOR", "LEPROSY", "HELPLINE"];
const fieldKeys: Record<string, string[]> = {
  SKIN_RECIPIENT: ["CR No.", "UHID", "Age", "Sex", "Address", "Mobile No.", "Indication for Transplant", "Size of Graft Transplanted"],
  SKIN_DONOR: ["Donor NOTTO ID", "Age", "Sex", "Address", "CR No.", "UHID", "Type of Death (BSD/DCD/NATURAL)", "Amount of Skin Retrieved", "Next of Kin Name", "Next of Kin Address", "Next of Kin Contact No."],
  LEPROSY: ["Age", "Sex", "Address", "Mobile No.", "Aadhaar Card No.", "Samagra ID", "Ayushman Card", "Diagnosis", "Date of Admission", "Date of Surgery", "Bank Account No.", "Bank Name", "Amount Released", "Amount"],
  HELPLINE: ["Patient ID", "Diagnosis", "Mobile", "Address", "Ward / Bed", "Description", "Resolved At"],
};
const moduleFor = (kind: string) =>
  kind.startsWith("SKIN_")
    ? "SKIN_BANK"
    : kind === "HELPLINE"
      ? "CM_HELPLINE"
      : kind;
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
function validateLeprosyPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid Leprosy record.";
  const payload = value as Record<string, unknown>;
  const mobile = digits(payload["Mobile No."]);
  const aadhaar = digits(payload["Aadhaar Card No."]);
  const amount = String(payload.Amount ?? "").trim();
  const released = String(payload["Amount Released"] ?? "NO").toUpperCase();
  if (mobile && mobile.length !== 10) return "Mobile number must contain 10 digits.";
  if (aadhaar && aadhaar.length !== 12) return "Aadhaar number must contain 12 digits.";
  if (amount && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) return "Amount must be zero or greater.";
  if (!['YES', 'NO'].includes(released)) return "Amount Released must be YES or NO.";
  for (const key of ["Date of Admission", "Date of Surgery"])
    if (payload[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload[key]))) return `${key} is invalid.`;
  payload["Mobile No."] = mobile;
  if (aadhaar) payload["Aadhaar Card No."] = aadhaar;
  payload["Amount Released"] = released;
  return null;
}
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      kind = u.searchParams.get("kind") ?? "",
      format = u.searchParams.get("format"),
      q = (u.searchParams.get("q") ?? "").trim(),
      from = u.searchParams.get("from") ?? "0000-01-01",
      to = u.searchParams.get("to") ?? "9999-12-31",
      like = likePattern(q),
      db = getDopsDb();
    if (!kinds.includes(kind)) return jsonError("Invalid register.");
    const access = await requirePermission(
      moduleFor(kind),
      format ? "EXPORT" : "VIEW",
    );
    if (isResponse(access)) return access;
    const r = await db
      .prepare(
        "SELECT id,kind,patient_id AS patientId,record_date AS recordDate,primary_name AS primaryName,status,payload FROM special_records WHERE kind=? AND deleted_at IS NULL AND record_date BETWEEN ? AND ? AND (?='' OR primary_name ILIKE ? OR payload ILIKE ?) ORDER BY record_date DESC,id DESC",
      )
      .bind(kind, from, to, q, like, like)
      .all();
    const rows = (
      r.results as Array<{
        id: number;
        kind: string;
        patientId: number | null;
        recordDate: string;
        primaryName: string;
        status: string;
        payload: string;
      }>
    ).map((x) => ({
      ...x,
      // CM Helpline now has only Pending/Resolved; older "In progress" cases count as Pending.
      status: kind === "HELPLINE" && x.status === "IN_PROGRESS" ? "PENDING" : x.status,
      payload: (() => {
        const p = decryptPayload(JSON.parse(String(x.payload)) as Record<string, unknown>);
        // Only Admins see Aadhaar / bank account numbers in full.
        return kind === "LEPROSY" && access.role !== "ADMIN" ? maskPayload(p) : p;
      })(),
    }));
    if (format === "csv" || format === "xls" || format === "xlsx") {
      // Register downloads (Leprosy includes Aadhaar/bank details for Admins) are audited.
      await db
        .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('EXPORT',?,NULL,?,?)")
        .bind(kind, actorDetails(access, `${kind} register ${from} to ${to} (${format === "csv" ? "CSV" : "XLSX"}, ${rows.length} rows${kind === "LEPROSY" ? access.role === "ADMIN" ? ", full identifiers" : ", masked identifiers" : ""})`), new Date().toISOString())
        .run();
      const discovered = Array.from(new Set(rows.flatMap((r) => Object.keys(r.payload as object)))),
        keys = [...(fieldKeys[kind] ?? []), ...discovered.filter((key) => !(fieldKeys[kind] ?? []).includes(key))],
        // Skin Bank follows the official proforma: no status column. Dates DD-MM-YYYY.
        skin = kind.startsWith("SKIN_"),
        cell = (value: unknown) => {
          const text = String(value ?? "");
          return /^\d{4}-\d{2}-\d{2}(T|$)/.test(text) ? formatDate(text) : text;
        },
        headers = ["S No", "Date", "Name", ...(skin ? [] : ["Status"]), ...keys],
        csv = [
          headers.map(csvCell).join(","),
          ...rows.map((r, i) =>
            [
              i + 1,
              formatDate(r.recordDate),
              r.primaryName,
              ...(skin ? [] : [r.status]),
              ...keys.map(
                (k) => cell((r.payload as Record<string, unknown>)[k]),
              ),
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\n");
      if (format === "xls" || format === "xlsx") {
        // A real .xlsx (see lib/xlsx.ts): opens without warnings in Excel,
        // LibreOffice and Google Sheets; Aadhaar/bank numbers stay exact.
        const title =
          kind === "SKIN_RECIPIENT"
            ? "PROFORMA FOR MONTHLY REPORTING OF TRANSPLANT OF SKIN TISSUE"
            : kind === "SKIN_DONOR"
              ? "PROFORMA FOR MONTHLY REPORTING OF SKIN TISSUE - DONORS"
              : kind === "LEPROSY"
                ? "LEPROSY PATIENT REGISTER"
                : "CM HELPLINE REGISTER";
        const workbook = await buildXlsx({
          sheetName: kind === "SKIN_RECIPIENT" ? "Skin Recipients" : kind === "SKIN_DONOR" ? "Skin Donors" : kind === "LEPROSY" ? "Leprosy" : "CM Helpline",
          titleLines: [
            title,
            "Name of State: MADHYA PRADESH",
            kind.startsWith("SKIN_") ? "Name of Skin Bank: JABALPUR SKIN BANK" : "Department: BURN & PLASTIC SURGERY",
            "Address: DEPT. OF BURN & PLASTIC SURGERY, NSCB MEDICAL COLLEGE JABALPUR",
            `Period: ${from} to ${to}    Total: ${rows.length}`,
          ],
          headers,
          rows: rows.map((row, i) => [i + 1, formatDate(row.recordDate), row.primaryName, ...(skin ? [] : [row.status]), ...keys.map((k) => cell((row.payload as Record<string, unknown>)[k]))]),
        });
        return new Response(new Uint8Array(workbook), {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="DOPS-${kind}-${from}-${to}.xlsx"`,
            "cache-control": "private, no-store",
          },
        });
      }
      return new Response(`\ufeff${csv}`, {
        headers: {
          "content-type": "text/csv",
          "content-disposition": `attachment; filename=DOPS-${kind}-${from}-${to}.csv`,
        },
      });
    }
    return Response.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    return jsonError("Could not load register.", 503);
  }
}
export async function POST(request: Request) {
  try {
    const b = (await request.json()) as Record<string, unknown>;
    if (b.action === "link_helpline") {
      const access = await requirePermission("CM_HELPLINE", "CREATE");
      if (isResponse(access)) return access;
      const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,64*1024)??rateLimit(access,"helpline-link",30,60_000);if(rejected)return rejected;
      // CM Helpline cases are raised from the Ward only. The ward stay decides
      // the patient, diagnosis and bed, so the client cannot mix up patients.
      const source = String(b.source ?? "").toUpperCase(),
        sourceRecordId = Number(b.sourceRecordId || 0),
        description = String(b.description ?? "").trim();
      if (source !== "WARD" || !sourceRecordId)
        return jsonError("CM Helpline cases can be added from the Ward only.");
      const db = getDopsDb(),
        now = new Date().toISOString();
      const stay = await db
        .prepare(
          `SELECT i.patient_id AS "patientId", i.diagnosis, w.ward_name AS "wardName", w.bed_number AS "bedNumber"
             FROM ward_stays w JOIN ipd_admissions i ON i.id = w.ipd_id WHERE w.id = ?`,
        )
        .bind(sourceRecordId)
        .first<{ patientId: number; diagnosis: string; wardName: string; bedNumber: string }>();
      if (!stay) return jsonError("Ward record not found.", 404);
      const patientId = Number(stay.patientId);
      const patient = await db
        .prepare(
          "SELECT id,name,patient_code AS \"patientCode\",mobile,address FROM patients WHERE id=? AND deleted_at IS NULL",
        )
        .bind(patientId)
        .first<{ id: number; name: string; patientCode: string; mobile: string; address: string }>();
      if (!patient) return jsonError("Patient not found.", 404);
      const existing = await db
        .prepare(
          "SELECT id FROM special_records WHERE kind='HELPLINE' AND patient_id=? AND deleted_at IS NULL AND status!='RESOLVED' LIMIT 1",
        )
        .bind(patientId)
        .first<{ id: number }>();
      if (existing)
        return jsonError(
          "This patient already has an active CM Helpline case.",
          409,
        );
      const diagnosisRow = { diagnosis: stay.diagnosis };
      const payload = JSON.stringify({
        "Patient ID": patient.patientCode,
        Diagnosis: diagnosisRow?.diagnosis ?? "",
        Mobile: patient.mobile,
        Address: patient.address,
        "Ward / Bed": `${stay.wardName} / ${stay.bedNumber}`,
        Source: source,
        "Source Record": sourceRecordId,
        Description: description,
        "Resolved At": "",
      });
      const row = await db
        .prepare(
          "INSERT INTO special_records (kind,patient_id,record_date,primary_name,status,payload,created_at,updated_at) VALUES ('HELPLINE',?,?,?,'PENDING',?,?,?) RETURNING id",
        )
        .bind(patientId, istDate(), patient.name, payload, now, now)
        .first<{ id: number }>();
      await db
        .prepare(
          "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('CREATE','HELPLINE',?,?,?)",
        )
        .bind(row?.id ?? null, actorDetails(access,`${patient.name} linked from ${source}`), now)
        .run();
      return Response.json(
        { success: true, data: { id: row?.id, status: "PENDING" } },
        { status: 201 },
      );
    }
    const kind = String(b.kind ?? ""),
      id = Number(b.id || 0),
      recordDate = String(b.recordDate ?? ""),
      primaryName = String(b.primaryName ?? "").trim(),
      status = String(b.status ?? "ACTIVE"),
      rawPayload = b.payload ?? {},
      db = getDopsDb(),
      now = new Date().toISOString();
    let patientId: number | null = b.patientId ? Number(b.patientId) : null;
    if (!kinds.includes(kind) || !recordDate || !primaryName)
      return jsonError("Complete required fields.");
    if (kind === "LEPROSY" && id && rawPayload && typeof rawPayload === "object") {
      // A non-admin edits a record whose Aadhaar/bank numbers they only saw masked
      // ("XXXXXXXX1234"): keep the stored numbers instead of saving the mask.
      const stored = await db.prepare("SELECT payload FROM special_records WHERE id=? AND kind='LEPROSY' AND deleted_at IS NULL").bind(id).first<{ payload: string }>();
      if (stored) {
        const previous = decryptPayload(JSON.parse(String(stored.payload)) as Record<string, unknown>);
        const incoming = rawPayload as Record<string, unknown>;
        for (const key of Object.keys(incoming))
          if (isSensitiveField(key) && looksMasked(incoming[key]) && previous[key] !== undefined) incoming[key] = previous[key];
      }
    }
    if (kind === "LEPROSY") {
      const validationError = validateLeprosyPayload(rawPayload);
      if (validationError) return jsonError(validationError);
    }
    const access = await requirePermission(
      moduleFor(kind),
      id ? "EDIT" : "CREATE",
    );
    if (isResponse(access)) return access;
    const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,128*1024)??rateLimit(access,"special-save",40,60_000);if(rejected)return rejected;
    let savedName = primaryName;
    let savedPayload = rawPayload as Record<string, unknown>;
    if (kind === "HELPLINE") {
      // Cases are created from the Ward (action "link_helpline"). Editing only
      // changes the status and description; the linked details stay as recorded.
      if (!id) return jsonError("CM Helpline cases are added from the Ward.");
      if (!["PENDING", "RESOLVED"].includes(status)) return jsonError("Status must be Pending or Resolved.");
      const current = await db.prepare("SELECT primary_name AS \"primaryName\",patient_id AS \"patientId\",payload FROM special_records WHERE id=? AND kind='HELPLINE' AND deleted_at IS NULL").bind(id).first<{ primaryName: string; patientId: number | null; payload: string }>();
      if (!current) return jsonError("CM Helpline case not found.", 404);
      const stored = JSON.parse(String(current.payload)) as Record<string, unknown>;
      if (current.patientId && status !== "RESOLVED") {
        const duplicate = await db.prepare("SELECT id FROM special_records WHERE kind='HELPLINE' AND patient_id=? AND id!=? AND deleted_at IS NULL AND status!='RESOLVED' LIMIT 1").bind(current.patientId, id).first();
        if (duplicate) return jsonError("This patient already has an active CM Helpline case.", 409);
      }
      savedName = current.primaryName;
      patientId = current.patientId; // never re-link a case to another patient
      savedPayload = {
        ...stored,
        Description: String(savedPayload.Description ?? stored.Description ?? "").trim(),
        "Resolved At": status === "RESOLVED" ? String(stored["Resolved At"] || "") || now : "",
      };
    }
    let payload: string;
    try {
      payload = JSON.stringify(kind === "LEPROSY" ? encryptPayload(savedPayload) : savedPayload);
    } catch (error) {
      if (error instanceof EncryptionConfigError) {
        console.error(error.message);
        return jsonError("Secure storage for Aadhaar/bank details is not configured. Contact the administrator.", 503);
      }
      throw error;
    }
    let recordId: number | null = null, auditDetail = savedName;
    if (id) {
      const previous = await db.prepare("SELECT kind,primary_name AS primaryName,status,payload FROM special_records WHERE id=? AND deleted_at IS NULL").bind(id).first<{ kind: string; primaryName: string; status: string; payload: string }>();
      if (!previous) return jsonError("Record not found.", 404);
      await db.prepare("INSERT INTO special_record_versions (record_id,kind,primary_name,status,payload,changed_by,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, previous.kind, previous.primaryName, previous.status, previous.payload, `User #${access.id} (${access.role})`, now).run();
      await db
        .prepare(
          "UPDATE special_records SET record_date=?,primary_name=?,status=?,patient_id=?,payload=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
        )
        .bind(recordDate, savedName, status, patientId, payload, now, id)
        .run();
      // Which fields changed (names only: values may be sensitive, e.g. Aadhaar).
      const oldPayload = decryptPayload(JSON.parse(String(previous.payload)) as Record<string, unknown>);
      const changedFields = Object.keys({ ...oldPayload, ...savedPayload }).filter((k) => String(oldPayload[k] ?? "") !== String(savedPayload[k] ?? ""));
      if (previous.primaryName !== savedName) changedFields.unshift("Name");
      if (previous.status !== status) changedFields.unshift(`Status ${previous.status} → ${status}`);
      auditDetail = `${savedName}: ${changedFields.join(", ") || "no changes"}`;
      recordId = id;
    } else {
      const created = await db
        .prepare(
          "INSERT INTO special_records (kind,patient_id,record_date,primary_name,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
        )
        .bind(
          kind,
          patientId,
          recordDate,
          savedName,
          status,
          payload,
          now,
          now,
        )
        .first<{ id: number }>();
      recordId = created?.id ?? null;
    }
    await db
      .prepare(
        "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(id ? "UPDATE" : "CREATE", kind, recordId, actorDetails(access, auditDetail.slice(0, 450)), now)
      .run();
    return Response.json({ success: true });
  } catch (e) {
    console.error(e);
    return jsonError("Could not save record.", 500);
  }
}
export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id")),
      db = getDopsDb(),
      now = new Date().toISOString();
    const record = await db
      .prepare(
        "SELECT kind FROM special_records WHERE id=? AND deleted_at IS NULL",
      )
      .bind(id)
      .first<{ kind: string }>();
    if (!record) return jsonError("Record not found.", 404);
    const access = await requirePermission(moduleFor(record.kind), "DELETE");
    if (isResponse(access)) return access;
    const rejected=rejectCrossSiteMutation(request)??rateLimit(access,"special-delete",20,60_000);if(rejected)return rejected;
    const snapshot = await db.prepare("SELECT primary_name AS primaryName,status,payload FROM special_records WHERE id=?").bind(id).first<{ primaryName: string; status: string; payload: string }>();
    await db.batch([
      db.prepare("INSERT INTO special_record_versions (record_id,kind,primary_name,status,payload,changed_by,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, record.kind, snapshot?.primaryName ?? "", snapshot?.status ?? "", snapshot?.payload ?? "{}", `User #${access.id} (${access.role})`, now),
      db.prepare("UPDATE special_records SET deleted_at=?,updated_at=? WHERE id=?").bind(now, now, id),
      db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('DELETE',?,?,?,?)").bind(record.kind,id,actorDetails(access,"Register row soft-deleted"),now),
    ]);
    return Response.json({ success: true });
  } catch {
    return jsonError("Could not remove record.", 500);
  }
}
