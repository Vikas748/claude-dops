import { getDopsDb, jsonError } from "@/lib/dops-db";
import { getDopsAccess, hasPermission, isResponse } from "@/lib/access";

export const dynamic = "force-dynamic";

type AlertItem = {
  id: string;
  type: "PAC_PENDING" | "OT_TODAY" | "OT_TOMORROW";
  title: string;
  detail: string;
  module: "Ward" | "OT";
  priority: "urgent" | "normal";
};

function indiaDate(offsetDays = 0) {
  const date = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const access = await getDopsAccess();
    if (isResponse(access)) return access;
    const db = getDopsDb(),
      today = indiaDate(),
      tomorrow = indiaDate(1),
      alerts: AlertItem[] = [];

    if (hasPermission(access, "WARD", "VIEW")) {
      const pending = await db
        .prepare(
          "SELECT w.id,w.ward_name AS wardName,w.bed_number AS bedNumber,p.patient_code AS patientCode,p.name FROM ward_stays w JOIN ipd_admissions i ON i.id=w.ipd_id JOIN patients p ON p.id=i.patient_id WHERE w.discharged_at IS NULL AND w.pac_status='PENDING' ORDER BY w.admitted_at",
        )
        .all<Record<string, unknown>>();
      for (const row of pending.results)
        alerts.push({
          id: `pac-${row.id}`,
          type: "PAC_PENDING",
          title: `PAC pending: ${row.name}`,
          detail: `${row.patientCode} · ${row.wardName}, bed ${row.bedNumber}`,
          module: "Ward",
          priority: "urgent",
        });
    }

    if (hasPermission(access, "OT", "VIEW")) {
      const procedures = await db
        .prepare(
          "SELECT o.id,o.scheduled_date AS scheduledDate,o.scheduled_time AS scheduledTime,o.procedure_name AS procedureName,p.patient_code AS patientCode,p.name FROM ot_procedures o JOIN ipd_admissions i ON i.id=o.ipd_id JOIN patients p ON p.id=i.patient_id WHERE o.status='SCHEDULED' AND o.scheduled_date IN (?,?) ORDER BY o.scheduled_date,o.scheduled_time",
        )
        .bind(today, tomorrow)
        .all<Record<string, unknown>>();
      for (const row of procedures.results) {
        const isToday = row.scheduledDate === today;
        alerts.push({
          id: `ot-${row.id}`,
          type: isToday ? "OT_TODAY" : "OT_TOMORROW",
          title: `${isToday ? "Today" : "Tomorrow"} OT: ${row.name}`,
          detail: `${row.scheduledTime} · ${row.procedureName} · ${row.patientCode}`,
          module: "OT",
          priority: isToday ? "urgent" : "normal",
        });
      }
    }

    return Response.json({
      success: true,
      data: {
        alerts,
        counts: {
          total: alerts.length,
          urgent: alerts.filter((item) => item.priority === "urgent").length,
          pacPending: alerts.filter((item) => item.type === "PAC_PENDING").length,
          otToday: alerts.filter((item) => item.type === "OT_TODAY").length,
          otTomorrow: alerts.filter((item) => item.type === "OT_TOMORROW").length,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("alerts GET failed", error);
    return jsonError("Could not load clinical alerts.", 503);
  }
}
