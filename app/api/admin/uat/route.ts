import { getDopsAccess, isResponse } from "@/lib/access";
import { istDate } from "@/lib/dates";
import { getDopsDb, jsonError } from "@/lib/dops-db";
import { actorDetails, enforceRequestSize, rateLimit, rejectCrossSiteMutation, csvCell } from "@/lib/security";
import { uatChecks, uatIds } from "@/lib/uat-checks";

export const dynamic = "force-dynamic";

async function admin() {
  const access = await getDopsAccess();
  if (isResponse(access)) return access;
  if (access.role !== "ADMIN") return jsonError("Admin access required.", 403);
  return access;
}


export async function GET(request: Request) {
  try {
    const access = await admin();
    if (access instanceof Response) return access;
    const db = getDopsDb(), saved = await db.prepare("SELECT id,status,notes,tested_by AS testedBy,tested_at AS testedAt,updated_at AS updatedAt FROM uat_results").all();
    const byId = new Map(saved.results.map((row) => [String(row.id), row]));
    const checks = uatChecks.map((check) => ({ ...check, status: "NOT_TESTED", notes: "", testedBy: null, testedAt: null, ...byId.get(check.id) }));
    const passed = checks.filter((check) => check.status === "PASS").length,
      failed = checks.filter((check) => check.status === "FAIL").length,
      blocked = checks.filter((check) => check.status === "BLOCKED").length;
    const summary = { total: checks.length, passed, failed, blocked, pending: checks.length - passed - failed - blocked, readyForSignOff: passed === checks.length };
    const acceptance = await db.prepare("SELECT department_representative AS departmentRepresentative,it_representative AS itRepresentative,decision,limitations,accepted_by AS acceptedBy,accepted_at AS acceptedAt,updated_at AS updatedAt FROM hospital_acceptance WHERE id=1").first();
    if (new URL(request.url).searchParams.get("format") === "csv") {
      const rows = [
        ["DOPS Hospital UAT Report"],
        ["Generated", new Date().toISOString()],
        ["Passed", passed, "Failed", failed, "Blocked", blocked, "Pending", summary.pending],
        ["Acceptance decision", acceptance?.decision ?? "NOT SIGNED", "Department representative", acceptance?.departmentRepresentative ?? "", "IT/Security representative", acceptance?.itRepresentative ?? ""],
        ["Open limitations", acceptance?.limitations ?? "", "Accepted by", acceptance?.acceptedBy ?? "", "Accepted at", acceptance?.acceptedAt ?? ""],
        [],
        ["Check ID", "Area", "Tester role", "Test", "Steps", "Expected result", "Status", "Evidence / issue notes", "Tested by", "Tested at"],
        ...checks.map((check) => [check.id, check.area, check.tester, check.title, check.steps.join(" | "), check.expected, check.status, check.notes, check.testedBy, check.testedAt]),
      ];
      return new Response(rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="dops-uat-${istDate()}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }
    return Response.json({ success: true, data: { checks, summary, acceptance: acceptance ?? null } });
  } catch (error) {
    console.error(error);
    return jsonError("Could not load UAT checklist.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const access = await admin();
    if (access instanceof Response) return access;
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 8 * 1024) ?? rateLimit(access, "uat-update", 60, 60_000);
    if (rejected) return rejected;
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "acceptance") {
      const departmentRepresentative = String(body.departmentRepresentative ?? "").trim().slice(0, 120),
        itRepresentative = String(body.itRepresentative ?? "").trim().slice(0, 120),
        decision = String(body.decision ?? ""), limitations = String(body.limitations ?? "").trim().slice(0, 2000);
      if (!departmentRepresentative || !itRepresentative || !["APPROVED", "CONDITIONAL", "REJECTED"].includes(decision)) return jsonError("Complete the acceptance record.");
      const db = getDopsDb(), passed = await db.prepare("SELECT COUNT(*) AS count FROM uat_results WHERE status='PASS'").first<{ count: number }>();
      if (decision === "APPROVED" && Number(passed?.count ?? 0) !== uatChecks.length) return jsonError("All UAT checks must pass before final approval.");
      if (decision === "CONDITIONAL" && !limitations) return jsonError("List the open limitations for conditional acceptance.");
      const now = new Date().toISOString(), by = `User #${access.id} (${access.role})`;
      await db.batch([
        db.prepare("INSERT INTO hospital_acceptance (id,department_representative,it_representative,decision,limitations,accepted_by,accepted_at,updated_at) VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET department_representative=excluded.department_representative,it_representative=excluded.it_representative,decision=excluded.decision,limitations=excluded.limitations,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,updated_at=excluded.updated_at").bind(departmentRepresentative, itRepresentative, decision, limitations, by, now, now),
        db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('SIGN_OFF','ADMIN',1,?,?)").bind(actorDetails(access, `Hospital acceptance marked ${decision}`), now),
      ]);
      return Response.json({ success: true });
    }
    const id = String(body.id ?? ""), status = String(body.status ?? ""), notes = String(body.notes ?? "").trim().slice(0, 1000);
    if (!uatIds.has(id) || !["NOT_TESTED", "PASS", "FAIL", "BLOCKED"].includes(status)) return jsonError("Invalid UAT result.");
    const now = new Date().toISOString(), tested = status === "NOT_TESTED" ? null : now, by = status === "NOT_TESTED" ? null : `User #${access.id} (${access.role})`, db = getDopsDb();
    await db.batch([
      db.prepare("INSERT INTO uat_results (id,status,notes,tested_by,tested_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,notes=excluded.notes,tested_by=excluded.tested_by,tested_at=excluded.tested_at,updated_at=excluded.updated_at").bind(id, status, notes, by, tested, now),
      db.prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('UAT','ADMIN',NULL,?,?)").bind(actorDetails(access, `${id} marked ${status}`), now),
    ]);
    return Response.json({ success: true });
  } catch (error) {
    console.error(error);
    return jsonError("Could not save UAT result.", 500);
  }
}
