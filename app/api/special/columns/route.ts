import { getDopsAccess, isResponse, requirePermission } from "@/lib/access";
import { getDopsDb, jsonError } from "@/lib/dops-db";
import { decryptPayload, maskPayload } from "@/lib/field-crypto";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";
const kinds = ["SKIN_RECIPIENT", "SKIN_DONOR"];
const protectedNames = new Set(["CR No.", "UHID", "Age", "Sex", "Address", "Mobile No.", "Indication for Transplant", "Size of Graft Transplanted", "Donor NOTTO ID", "Type of Death (BSD/DCD/NATURAL)", "Amount of Skin Retrieved", "Next of Kin Name", "Next of Kin Address", "Next of Kin Contact No."] .map((name) => name.toLowerCase()));

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), kind = url.searchParams.get("kind") ?? "", historyId = Number(url.searchParams.get("historyId") || 0);
    const db = getDopsDb();
    if (historyId) {
      // History belongs to the record's own register: check THAT permission
      // (previously any Skin Bank viewer could read Leprosy history unmasked).
      const record = await db.prepare("SELECT kind FROM special_records WHERE id=?").bind(historyId).first<{ kind: string }>();
      if (!record) return jsonError("Record not found.", 404);
      const historyModule = record.kind.startsWith("SKIN_") ? "SKIN_BANK" : record.kind === "HELPLINE" ? "CM_HELPLINE" : record.kind;
      const viewer = await requirePermission(historyModule, "VIEW");
      if (isResponse(viewer)) return viewer;
      const result = await db.prepare("SELECT id,primary_name AS primaryName,status,payload,changed_by AS changedBy,created_at AS createdAt FROM special_record_versions WHERE record_id=? ORDER BY id DESC LIMIT 25").bind(historyId).all();
      return Response.json({
        success: true,
        data: result.results.map((row) => {
          const payload = decryptPayload(JSON.parse(String(row.payload)) as Record<string, unknown>);
          return { ...row, payload: record.kind === "LEPROSY" && viewer.role !== "ADMIN" ? maskPayload(payload) : payload };
        }),
      });
    }
    const access = await requirePermission("SKIN_BANK", "VIEW");
    if (isResponse(access)) return access;
    if (!kinds.includes(kind)) return jsonError("Invalid Skin Bank register.");
    const result = await db.prepare("SELECT id,name,data_type AS dataType,position FROM register_columns WHERE kind=? AND deleted_at IS NULL ORDER BY position,id").bind(kind).all();
    return Response.json({ success: true, data: result.results });
  } catch (error) { console.error(error); return jsonError("Could not load register configuration.", 503); }
}

export async function POST(request: Request) {
  try {
    const access = await getDopsAccess();
    if (isResponse(access)) return access;
    if (access.role !== "ADMIN") return jsonError("Admin access required.", 403);
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 8 * 1024) ?? rateLimit(access, "register-column", 20, 60_000);
    if (rejected) return rejected;
    const body = await request.json() as Record<string, unknown>, kind = String(body.kind ?? ""), name = String(body.name ?? "").trim().slice(0, 80), dataType = String(body.dataType ?? "TEXT").toUpperCase();
    if (!kinds.includes(kind) || !name || !["TEXT", "NUMBER"].includes(dataType)) return jsonError("Enter a valid column.");
    if (protectedNames.has(name.toLowerCase())) return jsonError("Official proforma columns are protected.");
    const db = getDopsDb(), now = new Date().toISOString();
    const duplicate = await db.prepare("SELECT id FROM register_columns WHERE kind=? AND lower(name)=lower(?) AND deleted_at IS NULL").bind(kind, name).first();
    if (duplicate) return jsonError("A column with this name already exists.", 409);
    const position = await db.prepare("SELECT COALESCE(MAX(position),0)+1 AS next FROM register_columns WHERE kind=?").bind(kind).first<{ next: number }>();
    const row = await db.prepare("INSERT INTO register_columns (kind,name,data_type,position,created_at) VALUES (?,?,?,?,?) RETURNING id").bind(kind, name, dataType, Number(position?.next ?? 1), now).first<{ id: number }>();
    await db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('CREATE_COLUMN','SKIN_BANK',?,?,?)").bind(row?.id ?? null, actorDetails(access, `${kind}: ${name}`), now).run();
    return Response.json({ success: true }, { status: 201 });
  } catch (error) { console.error(error); return jsonError("Could not add column.", 500); }
}

export async function DELETE(request: Request) {
  try {
    const access = await getDopsAccess();
    if (isResponse(access)) return access;
    if (access.role !== "ADMIN") return jsonError("Admin access required.", 403);
    const rejected = rejectCrossSiteMutation(request) ?? rateLimit(access, "register-column-delete", 20, 60_000);
    if (rejected) return rejected;
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return jsonError("Invalid column.");
    const now = new Date().toISOString(), db = getDopsDb();
    await db.batch([
      db.prepare("UPDATE register_columns SET deleted_at=? WHERE id=? AND deleted_at IS NULL").bind(now, id),
      db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('DELETE_COLUMN','SKIN_BANK',?,?,?)").bind(id, actorDetails(access, "Custom column removed; historical row values retained"), now),
    ]);
    return Response.json({ success: true });
  } catch { return jsonError("Could not remove column.", 500); }
}
