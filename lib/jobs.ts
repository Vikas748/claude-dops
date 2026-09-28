/**
 * Scheduled jobs, run by Vercel Cron through /api/cron/[job].
 *
 *   monthly-reports  1st of each month, 06:00 IST: emails last month's OPD and
 *                    OT PDF reports to the report recipients.
 *   daily            every day, 18:00 IST: emails tomorrow's OT list to OT
 *                    staff (PAC-pending cases highlighted), then housekeeping.
 *
 * Each run first claims a (job, run_key) row in job_runs, so a repeated
 * invocation for the same month/day does nothing.
 *
 * Server-only module.
 */
import { cleanupAuthTables } from "@/lib/auth";
import { istDate as istDateShared } from "@/lib/dates";
import { getDopsDb } from "@/lib/dops-db";
import { sendMail } from "@/lib/mailer";
import { displayDate, istNow, letterhead, loadReport, periodLabel, renderReportPdf, reportFileName } from "@/lib/reports";
import { cleanupStaleUploads } from "@/lib/uploads";

/** Date string (YYYY-MM-DD) in India, optionally shifted by whole days. */
export const istDate = (now = new Date(), dayOffset = 0) => istDateShared(dayOffset, now);

/** First and last day of the month before the current IST month. */
export function previousMonthIst(now = new Date()) {
  const [y, m] = istDate(now).split("-").map(Number);
  const year = m === 1 ? y - 1 : y, month = m === 1 ? 12 : m - 1;
  return monthRange(`${year}-${String(month).padStart(2, "0")}`);
}

export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Month must be YYYY-MM.");
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Claims a run. Returns false if this job already ran (or is running) for the key. */
async function claimRun(job: string, runKey: string, force: boolean) {
  const db = getDopsDb();
  if (force) await db.prepare("DELETE FROM job_runs WHERE job=? AND run_key=?").bind(job, runKey).run();
  const row = await db
    .prepare("INSERT INTO job_runs (job,run_key) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING job")
    .bind(job, runKey)
    .first();
  return Boolean(row);
}

async function finishRun(job: string, runKey: string, detail: string) {
  await getDopsDb()
    .prepare("UPDATE job_runs SET status='DONE', detail=?, finished_at=now() WHERE job=? AND run_key=?")
    .bind(detail.slice(0, 500), job, runKey)
    .run();
}

/** Releases a claim after a failure, so the next invocation retries. */
async function releaseRun(job: string, runKey: string) {
  await getDopsDb().prepare("DELETE FROM job_runs WHERE job=? AND run_key=? AND status='RUNNING'").bind(job, runKey).run();
}

async function audit(action: string, details: string) {
  await getDopsDb()
    .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES (?, 'SYSTEM', NULL, ?, ?)")
    .bind(action, details.slice(0, 500), new Date().toISOString())
    .run();
}

/** REPORT_EMAILS (comma separated) if set, otherwise every active Admin. */
export async function reportRecipients() {
  const configured = (process.env.REPORT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (configured.length) return Array.from(new Set(configured));
  const admins = await getDopsDb()
    .prepare("SELECT lower(email) AS email FROM department_users WHERE role='ADMIN' AND status='ACTIVE' ORDER BY id")
    .all<{ email: string }>();
  return admins.results.map((a) => a.email);
}

/** Active users who can see the OT module (and all active Admins). */
async function otRecipients() {
  const users = await getDopsDb()
    .prepare("SELECT lower(email) AS email, role, permissions FROM department_users WHERE status='ACTIVE'")
    .all<{ email: string; role: string; permissions: string }>();
  return users.results
    .filter((u) => {
      if (u.role === "ADMIN") return true;
      try {
        return (JSON.parse(u.permissions || "[]") as string[]).includes("OT:VIEW");
      } catch {
        return false;
      }
    })
    .map((u) => u.email);
}

export type JobResult = { job: string; runKey: string; skipped?: string; detail?: string };

export async function runMonthlyReports(options: { month?: string; force?: boolean; now?: Date } = {}): Promise<JobResult> {
  const job = "monthly-reports";
  const period = options.month ? monthRange(options.month) : previousMonthIst(options.now);
  if (!(await claimRun(job, period.month, Boolean(options.force))))
    return { job, runKey: period.month, skipped: "already sent for this month" };
  try {
    const recipients = await reportRecipients();
    if (!recipients.length) throw new Error("No report recipients: set REPORT_EMAILS or add an active Admin.");
    const [opd, ot] = await Promise.all([loadReport("opd", period.from, period.to), loadReport("ot", period.from, period.to)]);
    const [opdPdf, otPdf] = await Promise.all([
      renderReportPdf(opd, { generatedBy: "DOPS monthly report" }),
      renderReportPdf(ot, { generatedBy: "DOPS monthly report" }),
    ]);
    const { hospital, department } = letterhead();
    const label = periodLabel(period.from, period.to);
    const text = [
      `DOPS monthly reports — ${label}`,
      "",
      `${hospital}, ${department}`,
      "",
      `OPD patients registered: ${opd.rows.length}`,
      `OT procedures scheduled: ${ot.rows.length}`,
      "",
      "The OPD and OT registers are attached as PDF files.",
      "They contain confidential patient information: do not forward outside the department.",
      "",
      `Generated automatically on ${istNow(options.now)}.`,
    ].join("\n");
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2933;max-width:560px">
<h2 style="margin:0 0 4px">DOPS monthly reports — ${escapeHtml(label)}</h2>
<p style="margin:0 0 16px;color:#52606d">${escapeHtml(hospital)}, ${escapeHtml(department)}</p>
<table style="border-collapse:collapse;margin-bottom:16px">
<tr><td style="padding:4px 16px 4px 0">OPD patients registered</td><td style="font-weight:700">${opd.rows.length}</td></tr>
<tr><td style="padding:4px 16px 4px 0">OT procedures scheduled</td><td style="font-weight:700">${ot.rows.length}</td></tr>
</table>
<p>The OPD and OT registers are attached as PDF files.</p>
<p style="color:#b91c1c">They contain confidential patient information: do not forward outside the department.</p>
<p style="color:#9aa5b1;font-size:12px">Generated automatically on ${escapeHtml(istNow(options.now))}.</p></div>`;
    await sendMail({
      to: recipients,
      subject: `DOPS monthly OPD & OT reports — ${label}`,
      text,
      html,
      attachments: [
        { filename: reportFileName(opd, "pdf"), content: opdPdf, contentType: "application/pdf" },
        { filename: reportFileName(ot, "pdf"), content: otPdf, contentType: "application/pdf" },
      ],
    });
    const detail = `Sent ${label} reports (OPD ${opd.rows.length}, OT ${ot.rows.length}) to ${recipients.length} recipient(s)`;
    await finishRun(job, period.month, detail);
    await audit("REPORT_EMAIL", detail);
    return { job, runKey: period.month, detail };
  } catch (error) {
    await releaseRun(job, period.month).catch(() => undefined);
    throw error;
  }
}

type OtRow = { time: string; patientId: string; name: string; procedure: string; surgeon: string; pac: string };

export async function runDaily(options: { force?: boolean; now?: Date } = {}): Promise<JobResult> {
  const job = "daily", tomorrow = istDate(options.now, 1), runKey = istDate(options.now);
  if (!(await claimRun(job, runKey, Boolean(options.force)))) return { job, runKey, skipped: "already ran today" };
  const notes: string[] = [];
  try {
    // 1) Tomorrow's OT list
    const list = await getDopsDb()
      .prepare(
        `SELECT o.scheduled_time AS "time", p.patient_code AS "patientId", p.name AS "name",
                o.procedure_name AS "procedure", o.surgeon_name AS "surgeon", o.pac_status AS "pac"
           FROM ot_procedures o JOIN ipd_admissions i ON i.id=o.ipd_id JOIN patients p ON p.id=i.patient_id
          WHERE o.scheduled_date=? AND o.status='SCHEDULED' AND p.deleted_at IS NULL
          ORDER BY o.scheduled_time, o.id`,
      )
      .bind(tomorrow)
      .all<OtRow>();
    const rows = list.results;
    if (rows.length) {
      const recipients = await otRecipients();
      const pending = rows.filter((r) => String(r.pac).toUpperCase() === "PENDING").length;
      if (recipients.length) {
        const day = displayDate(tomorrow);
        const tableRows = rows
          .map((r) => {
            const warn = String(r.pac).toUpperCase() === "PENDING";
            return `<tr${warn ? ' style="background:#fef2f2"' : ""}><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.name)}<br><span style="color:#52606d;font-size:12px">${escapeHtml(r.patientId)}</span></td><td>${escapeHtml(r.procedure)}</td><td>${escapeHtml(r.surgeon)}</td><td style="font-weight:700;color:${warn ? "#b91c1c" : "#0f766e"}">${escapeHtml(r.pac)}</td></tr>`;
          })
          .join("");
        await sendMail({
          // Addressed to the department mailbox itself; staff receive it as BCC.
          to: process.env.SMTP_USER?.trim() || recipients[0],
          bcc: recipients,
          subject: `DOPS OT list for ${day}: ${rows.length} case(s)${pending ? `, ${pending} PAC pending` : ""}`,
          text: [
            `OT list for ${day} (${rows.length} case(s))${pending ? ` — ${pending} still PAC pending` : ""}`,
            "",
            ...rows.map((r) => `${r.time}  ${r.name} (${r.patientId}) — ${r.procedure} — ${r.surgeon} — PAC: ${r.pac}`),
            "",
            "Confidential patient information: for department staff only.",
          ].join("\n"),
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
<h2 style="margin:0 0 4px">OT list for ${escapeHtml(day)}</h2>
<p style="margin:0 0 12px;color:#52606d">${rows.length} case(s)${pending ? ` · <strong style="color:#b91c1c">${pending} PAC pending</strong>` : ""}</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px"><thead><tr style="background:#0f766e;color:#fff"><th align="left">Time</th><th align="left">Patient</th><th align="left">Procedure</th><th align="left">Surgeon</th><th align="left">PAC</th></tr></thead><tbody>${tableRows}</tbody></table>
<p style="color:#9aa5b1;font-size:12px">Confidential patient information: for department staff only.</p></div>`,
        });
        notes.push(`OT reminder for ${tomorrow}: ${rows.length} case(s), ${pending} PAC pending, to ${recipients.length} user(s)`);
      } else notes.push(`OT reminder for ${tomorrow}: no OT recipients`);
    } else notes.push(`No OT scheduled for ${tomorrow}`);

    // 2) Housekeeping (never fails the job)
    try {
      const removed = await cleanupStaleUploads(200);
      await cleanupAuthTables();
      notes.push(`cleanup: ${removed} stale upload(s) removed`);
    } catch (error) {
      notes.push(`cleanup failed: ${error instanceof Error ? error.message : "error"}`);
    }

    const detail = notes.join("; ");
    await finishRun(job, runKey, detail);
    if (rows.length) await audit("OT_REMINDER", detail);
    return { job, runKey, detail };
  } catch (error) {
    await releaseRun(job, runKey).catch(() => undefined);
    throw error;
  }
}
