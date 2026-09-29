/**
 * Monthly OPD / OT reports: data, printable PDF and Excel-friendly CSV.
 * Shared by the download route and the monthly email job.
 *
 * PDFs use the Hind font (Indian Type Foundry, SIL OFL — assets/fonts/OFL.txt),
 * which covers both Latin and Devanagari. pdfkit's font engine performs the
 * OpenType shaping Hindi needs (matras, conjuncts, reph), so names such as
 * "क्षितिज" or "श्रीमती" print correctly.
 *
 * Server-only module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { getDopsDb } from "@/lib/dops-db";
import { csvCell } from "@/lib/security";

export type ReportModule = "opd" | "ot";

type Column = { key: string; label: string; width: number; align?: "left" | "right" | "center" };

export type ReportData = {
  module: ReportModule;
  title: string;
  from: string;
  to: string;
  columns: Column[];
  rows: Record<string, unknown>[];
};

export class ReportInputError extends Error {}

const REPORTS: Record<ReportModule, { title: string; columns: Column[]; sql: string }> = {
  opd: {
    title: "OPD Patient Register",
    // Widths are relative; they are scaled to the page width.
    columns: [
      { key: "date", label: "Date", width: 62 },
      { key: "patientId", label: "Patient ID", width: 88 },
      { key: "opdNumber", label: "OPD No./UHID", width: 78 },
      { key: "name", label: "Name", width: 125 },
      { key: "age", label: "Age", width: 32, align: "right" },
      { key: "sex", label: "Sex", width: 44 },
      { key: "diagnosis", label: "Diagnosis", width: 190 },
      { key: "mobile", label: "Mobile", width: 72 },
      { key: "address", label: "Address", width: 140 },
    ],
    sql: `SELECT o.visit_date AS "date", p.patient_code AS "patientId", p.opd_number AS "opdNumber", p.name AS "name", p.age AS "age",
                 p.sex AS "sex", o.diagnosis AS "diagnosis", p.mobile AS "mobile", p.address AS "address"
            FROM opd_visits o JOIN patients p ON p.id = o.patient_id
           WHERE o.deleted_at IS NULL AND p.deleted_at IS NULL AND o.visit_date BETWEEN ? AND ?
           ORDER BY o.visit_date, o.id`,
  },
  ot: {
    title: "Operation Theatre Register",
    columns: [
      { key: "date", label: "Date", width: 62 },
      { key: "time", label: "Time", width: 38 },
      { key: "patientId", label: "Patient ID", width: 88 },
      { key: "name", label: "Name", width: 120 },
      { key: "diagnosis", label: "Diagnosis", width: 150 },
      { key: "procedure", label: "Procedure", width: 160 },
      { key: "surgeon", label: "Surgeon", width: 90 },
      { key: "pac", label: "PAC", width: 50 },
      { key: "status", label: "Status", width: 62 },
    ],
    sql: `SELECT o.scheduled_date AS "date", o.scheduled_time AS "time", p.patient_code AS "patientId",
                 p.name AS "name", i.diagnosis AS "diagnosis", o.procedure_name AS "procedure",
                 o.surgeon_name AS "surgeon", o.pac_status AS "pac", o.status AS "status"
            FROM ot_procedures o JOIN ipd_admissions i ON i.id = o.ipd_id JOIN patients p ON p.id = i.patient_id
           WHERE o.scheduled_date BETWEEN ? AND ?
           ORDER BY o.scheduled_date, o.scheduled_time, o.id`,
  },
};

export const letterhead = () => ({
  hospital: process.env.DOPS_HOSPITAL_NAME?.trim() || "NSCB Medical College, Jabalpur",
  department: process.env.DOPS_DEPARTMENT_NAME?.trim() || "Department of Burn & Plastic Surgery",
});

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string) {
  if (!isoDate.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Validates the period and loads the rows. */
export async function loadReport(module: string, from: string, to: string): Promise<ReportData> {
  const config = REPORTS[module as ReportModule];
  if (!config) throw new ReportInputError("Invalid report module.");
  if (!validDate(from) || !validDate(to)) throw new ReportInputError("Choose a valid date range.");
  if (from > to) throw new ReportInputError("The start date must be on or before the end date.");
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 366) throw new ReportInputError("A report can cover at most one year.");
  const result = await getDopsDb().prepare(config.sql).bind(from, to).all<Record<string, unknown>>();
  return { module: module as ReportModule, title: config.title, from, to, columns: config.columns, rows: result.results };
}

// ---------- formatting helpers ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-09-07 -> 07-09-2026 (the DOPS display format everywhere) */
export function displayDate(value: unknown) {
  const s = String(value ?? "");
  if (!isoDate.test(s.slice(0, 10))) return s;
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

/** A readable period label: "September 2026" for a whole month, else "01 Sep 2026 – 15 Sep 2026". */
export function periodLabel(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (fy === ty && fm === tm && fd === 1 && td === lastDay)
    return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][fm - 1]} ${fy}`;
  return `${displayDate(from)} – ${displayDate(to)}`;
}

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function cellText(column: Column, value: unknown) {
  if (column.key === "date") return displayDate(value);
  if (column.key === "status" || column.key === "pac") {
    const s = clean(value);
    return s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "";
  }
  return clean(value);
}

/** Indian Standard Time timestamp for "Generated on". */
export function istNow(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const hh = ist.getUTCHours(), mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${displayDate(ist.toISOString().slice(0, 10))}, ${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? "AM" : "PM"} IST`;
}

// ---------- CSV ----------

/** UTF-8 CSV with BOM (so Excel shows Hindi correctly) and formula-injection protection. */
export function renderReportCsv(report: ReportData) {
  const lines = [
    report.columns.map((c) => csvCell(c.label)).join(","),
    ...report.rows.map((row) => report.columns.map((c) => csvCell(cellText(c, row[c.key]))).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ---------- PDF ----------

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
function fonts() {
  if (!fontCache) {
    const dir = join(process.cwd(), "assets", "fonts");
    fontCache = { regular: readFileSync(join(dir, "Hind-Regular.ttf")), bold: readFileSync(join(dir, "Hind-SemiBold.ttf")) };
  }
  return fontCache;
}

const INK = "#1f2933", MUTED = "#52606d", RULE = "#cbd2d9", BAND = "#f0f4f8", ACCENT = "#0f766e";

/** Renders a printable A4-landscape PDF with letterhead, period, count and page numbers. */
export async function renderReportPdf(report: ReportData, options: { generatedBy?: string; now?: Date } = {}) {
  const { regular, bold } = fonts();
  const { hospital, department } = letterhead();
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 36, bottom: 44, left: 36, right: 36 },
    bufferPages: true,
    font: regular as unknown as string, // start with Hind so pdfkit never needs its built-in Helvetica files
    info: { Title: `${report.title} — ${periodLabel(report.from, report.to)}`, Author: `${hospital}, ${department}`, Creator: "DOPS" },
  });
  doc.registerFont("body", regular);
  doc.registerFont("bold", bold);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const scale = usable / report.columns.reduce((sum, c) => sum + c.width, 0);
  const widths = report.columns.map((c) => c.width * scale);
  const pad = 4, fontSize = 8.5, headerSize = 8.5;

  // Letterhead (first page) ---------------------------------------------
  doc.font("bold").fontSize(15).fillColor(INK).text(hospital, left, 36, { width: usable, align: "center" });
  doc.font("body").fontSize(10.5).fillColor(MUTED).text(department, { width: usable, align: "center" });
  let y = doc.y + 6;
  doc.moveTo(left, y).lineTo(left + usable, y).lineWidth(1.2).strokeColor(ACCENT).stroke();
  y += 8;
  doc.font("bold").fontSize(13).fillColor(INK).text(`${report.title} — ${periodLabel(report.from, report.to)}`, left, y, { width: usable });
  y = doc.y + 2;
  doc.font("body").fontSize(9).fillColor(MUTED);
  const count = `Total ${report.module === "opd" ? "patients" : "procedures"}: ${report.rows.length}`;
  doc.text(`Period: ${displayDate(report.from)} to ${displayDate(report.to)}    |    ${count}`, left, y, { width: usable * 0.65 });
  doc.text(`Generated: ${istNow(options.now)}${options.generatedBy ? ` by ${clean(options.generatedBy)}` : ""}`, left + usable * 0.45, y, {
    width: usable * 0.55,
    align: "right",
  });
  y = doc.y + 10;

  // Table ------------------------------------------------------------------
  const drawHeader = () => {
    const h = 18;
    doc.rect(left, y, usable, h).fill(ACCENT);
    let x = left;
    doc.font("bold").fontSize(headerSize).fillColor("#ffffff");
    report.columns.forEach((c, i) => {
      doc.text(c.label, x + pad, y + 4.5, { width: widths[i] - pad * 2, align: c.align ?? "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += h;
  };
  drawHeader();

  if (!report.rows.length) {
    doc.font("body").fontSize(10).fillColor(MUTED).text("No records in this period.", left, y + 14, { width: usable, align: "center" });
  }

  doc.font("body").fontSize(fontSize);
  report.rows.forEach((row, index) => {
    const texts = report.columns.map((c) => cellText(c, row[c.key]));
    const heights = texts.map((t, i) => doc.heightOfString(t || " ", { width: widths[i] - pad * 2 }));
    const h = Math.max(...heights) + pad * 2;
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      doc.font("body").fontSize(fontSize);
    }
    if (index % 2 === 1) doc.rect(left, y, usable, h).fill(BAND);
    let x = left;
    doc.fillColor(INK);
    texts.forEach((t, i) => {
      doc.text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: report.columns[i].align ?? "left" });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.4).strokeColor(RULE).stroke();
    y += h;
  });

  // Footer on every page -----------------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - 30;
    doc.font("body").fontSize(7.5).fillColor(MUTED);
    // Writing inside the bottom margin: disable auto page breaks for these lines.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.text("Confidential patient information — for departmental use only.", left, fy, { width: usable / 2, lineBreak: false });
    doc.text(`${report.title} · ${periodLabel(report.from, report.to)} · Page ${i - range.start + 1} of ${range.count}`, left + usable / 2, fy, {
      width: usable / 2,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return finished;
}

export function reportFileName(report: ReportData, extension: "pdf" | "csv") {
  return `DOPS-${report.module.toUpperCase()}-${report.from}-to-${report.to}.${extension}`;
}
