import { getDopsDb, jsonError } from "@/lib/dops-db";
import { actorDetails } from "@/lib/security";
import { istDate } from "@/lib/dates";
import { isResponse, requirePermission } from "@/lib/access";
import { loadReport, renderReportCsv, renderReportPdf, reportFileName, ReportInputError } from "@/lib/reports";

export const dynamic = "force-dynamic";

/** Current month in India (UTC+5:30), so "this month" is right around midnight. */
function currentMonthIst() {
  const ist = istDate();
  return { from: `${ist.slice(0, 7)}-01`, to: ist };
}

export async function GET(request: Request, { params }: { params: Promise<{ module: string }> }) {
  try {
    const reportModule = (await params).module.toLowerCase();
    const url = new URL(request.url);
    const fallback = currentMonthIst();
    const from = url.searchParams.get("from") || fallback.from;
    const to = url.searchParams.get("to") || fallback.to;
    const format = url.searchParams.get("format") === "csv" ? "csv" : "pdf";
    if (reportModule !== "opd" && reportModule !== "ot") return jsonError("Invalid report module.", 404);
    const access = await requirePermission(reportModule.toUpperCase(), "EXPORT");
    if (isResponse(access)) return access;

    const report = await loadReport(reportModule, from, to);
    // Downloading a whole register is an audited event (who took which data, when).
    await getDopsDb()
      .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES ('EXPORT',?,NULL,?,?)")
      .bind(reportModule.toUpperCase(), actorDetails(access, `${report.title} ${from} to ${to} (${format.toUpperCase()}, ${report.rows.length} rows)`), new Date().toISOString())
      .run();
    const headers = {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${reportFileName(report, format)}"`,
    };
    if (format === "csv")
      return new Response(renderReportCsv(report), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
    const pdf = await renderReportPdf(report, { generatedBy: access.name });
    return new Response(new Uint8Array(pdf), { headers: { ...headers, "content-type": "application/pdf" } });
  } catch (error) {
    if (error instanceof ReportInputError) return jsonError(error.message);
    console.error("Report generation failed", error);
    return jsonError("Report generation failed.", 500);
  }
}
