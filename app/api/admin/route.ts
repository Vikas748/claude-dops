import { getDopsDb, jsonError } from "@/lib/dops-db";
import { getDopsAccess, isResponse } from "@/lib/access";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation } from "@/lib/security";
export const dynamic = "force-dynamic";
const modules = ["OPD", "IPD", "WARD", "OT", "CLASS", "SKIN_BANK", "RESEARCH", "PUBLICATION", "LEPROSY", "CM_HELPLINE"];
const actions = ["VIEW", "CREATE", "EDIT", "DELETE", "EXPORT"];
const validPermissions = new Set(
  modules.flatMap((module) => actions.map((action) => `${module}:${action}`)),
);
async function current() {
  const access = await getDopsAccess();
  if (isResponse(access)) return null;
  return getDopsDb().prepare("SELECT * FROM department_users WHERE id=?").bind(access.id).first<Record<string, unknown>>();
}
export async function GET() {
  try {
    const me = await current();
    if (!me) return jsonError("Authentication required.", 401);
    const db = getDopsDb();
    if (me.role !== "ADMIN")
      return Response.json({
        success: true,
        data: { me, users: [], logs: [] },
      });
    const [users, logs] = await Promise.all([
      db
        .prepare(
          "SELECT id,name,email,mobile,role,status,permissions,last_login AS lastLogin FROM department_users ORDER BY id",
        )
        .all(),
      db
        .prepare(
          "SELECT id,action,module,record_id AS recordId,details,created_at AS createdAt FROM audit_logs ORDER BY id DESC LIMIT 100",
        )
        .all(),
    ]);
    return Response.json({
      success: true,
      data: {
        me,
        users: users.results.map((u) => ({
          ...u,
          permissions: JSON.parse(String(u.permissions)),
        })),
        logs: logs.results,
      },
    });
  } catch (e) {
    console.error(e);
    return jsonError("Could not load administration.", 503);
  }
}
export async function POST(request: Request) {
  try {
    const me = await current();
    if (!me || me.role !== "ADMIN")
      return jsonError("Admin access required.", 403);
    const adminAccess={id:Number(me.id),role:"ADMIN",status:"ACTIVE",permissions:[]};
    const rejected=rejectCrossSiteMutation(request)??enforceRequestSize(request,64*1024)??rateLimit(adminAccess,"admin-user-save",20,60_000);if(rejected)return rejected;
    const b = (await request.json()) as Record<string, unknown>,
      db = getDopsDb(),
      now = new Date().toISOString(),
      id = Number(b.id || 0),
      name = String(b.name ?? "").trim(),
      email = String(b.email ?? "")
        .trim()
        .toLowerCase(),
      mobile = String(b.mobile ?? "").trim(),
      role = String(b.role ?? "RESIDENT"),
      status = String(b.status ?? "PENDING"),
      requestedPermissions = Array.isArray(b.permissions)
        ? b.permissions.map(String)
        : [],
      permissions = JSON.stringify(
        requestedPermissions.filter((permission) => validPermissions.has(permission)),
      );
    if (
      !name ||
      !email ||
      !["ADMIN", "DOCTOR", "RESIDENT", "NURSE", "STAFF"].includes(role) ||
      !["PENDING", "ACTIVE", "INACTIVE"].includes(status)
    )
      return jsonError("Invalid user details.");
    if (id === Number(me.id) && (role !== "ADMIN" || status !== "ACTIVE"))
      return jsonError("You cannot revoke your own active administrator access.");
    // Record exactly what changed: role/permission changes are the most
    // security-relevant events in the audit log.
    let recordId = id || null, change = `created ${email} as ${role}, ${status}, permissions: ${JSON.parse(permissions).join(", ") || "none"}`;
    if (id) {
      const before = await db
        .prepare("SELECT name,email,mobile,role,status,permissions FROM department_users WHERE id=?")
        .bind(id)
        .first<{ name: string; email: string; mobile: string | null; role: string; status: string; permissions: string }>();
      if (!before) return jsonError("User not found.", 404);
      await db
        .prepare(
          "UPDATE department_users SET name=?,email=?,mobile=?,role=?,status=?,permissions=?,updated_at=? WHERE id=?",
        )
        .bind(name, email, mobile, role, status, permissions, now, id)
        .run();
      const parts: string[] = [];
      if (before.role !== role) parts.push(`role ${before.role} → ${role}`);
      if (before.status !== status) parts.push(`status ${before.status} → ${status}`);
      if (before.email.toLowerCase() !== email) parts.push(`email ${before.email} → ${email}`);
      if (before.name !== name) parts.push("name changed");
      if ((before.mobile ?? "") !== mobile) parts.push("mobile changed");
      let oldPerms: string[] = [];
      try { oldPerms = JSON.parse(before.permissions || "[]"); } catch {}
      const newPerms: string[] = JSON.parse(permissions);
      const added = newPerms.filter((x) => !oldPerms.includes(x)), removed = oldPerms.filter((x) => !newPerms.includes(x));
      if (added.length) parts.push(`permissions added: ${added.join(", ")}`);
      if (removed.length) parts.push(`permissions removed: ${removed.join(", ")}`);
      change = `${email}: ${parts.join("; ") || "no changes"}`;
    } else {
      const created = await db
        .prepare(
          "INSERT INTO department_users (name,email,mobile,role,status,permissions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
        )
        .bind(name, email, mobile, role, status, permissions, now, now)
        .first<{ id: number }>();
      recordId = created?.id ?? null;
    }
    await db
      .prepare(
        "INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(
        id ? "UPDATE" : "CREATE",
        "ADMIN",
        recordId,
        actorDetails(adminAccess, change.slice(0, 450)),
        now,
      )
      .run();
    return Response.json({ success: true });
  } catch (e) {
    // Postgres unique violation (email is unique, case-insensitively).
    if ((e as { code?: string })?.code === "23505")
      return jsonError("A user with this email address already exists. Edit that user instead.", 409);
    console.error(e);
    return jsonError("Could not save user.", 500);
  }
}
