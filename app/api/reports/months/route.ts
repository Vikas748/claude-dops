import { isResponse, requirePermission } from "@/lib/access";
import { getDopsDb, jsonError } from "@/lib/dops-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const reportModule = (new URL(request.url).searchParams.get("module") ?? "").toLowerCase();
    if (!["opd", "emergency", "ot"].includes(reportModule)) return jsonError("Invalid report module.");
    // Emergency OPD is part of the OPD module for permissions.
    const access = await requirePermission(reportModule === "ot" ? "OT" : "OPD", "EXPORT");
    if (isResponse(access)) return access;
    const db = getDopsDb();
    const result = reportModule !== "ot"
      ? await db.prepare("SELECT substr(visit_date,1,7) AS month,COUNT(*) AS count FROM opd_visits WHERE deleted_at IS NULL AND visit_type=? GROUP BY substr(visit_date,1,7) ORDER BY month DESC").bind(reportModule === "emergency" ? "EMERGENCY" : "OPD").all()
      : await db.prepare("SELECT substr(scheduled_date,1,7) AS month,COUNT(*) AS count FROM ot_procedures GROUP BY substr(scheduled_date,1,7) ORDER BY month DESC").all();
    const counts = new Map(result.results.map((row) => [String(row.month), Number(row.count)]));
    const current = new Date(), months = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - index, 1));
      const month = date.toISOString().slice(0, 7);
      return { month, count: counts.get(month) ?? 0 };
    });
    for (const [month, count] of counts) if (!months.some((item) => item.month === month)) months.push({ month, count });
    months.sort((a, b) => b.month.localeCompare(a.month));
    return Response.json({ success: true, data: months }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error(error);
    return jsonError("Could not load monthly report archive.", 503);
  }
}
