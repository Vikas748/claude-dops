/**
 * Minimal, dependency-light .xlsx writer (Office Open XML) built on jszip.
 *
 * Why not the old HTML-as-.xls trick: Excel warns that the file is not really
 * .xls, and LibreOffice ignores its text-format hints, so bank account numbers
 * lost leading zeros. Here every cell has an explicit type:
 *   - text cells are written as inline strings, so they are never formulas
 *     (no formula injection) and "000123…" / 12-digit Aadhaar stay exact;
 *   - plain numbers (age, amount) stay numeric so they can be summed.
 *
 * Server-only module.
 */
import JSZip from "jszip";

export type SheetInput = {
  sheetName: string;
  /** Lines printed above the table (proforma title, state, period…). First is bold. */
  titleLines: string[];
  headers: string[];
  rows: unknown[][];
};

// Characters not allowed in XML 1.0 are removed.
const xmlText = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Numbers that are safe to store numerically (not IDs that would be damaged). */
function isPlainNumber(text: string) {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return false;
  const digits = text.replace(/^-/, "").split(".")[0];
  return digits.length <= 10 && !(digits.length > 1 && digits.startsWith("0"));
}

// style 0 = normal, 1 = bold, 2 = bold header with fill + border, 3 = bordered cell (wrap)
function cell(ref: string, value: unknown, style: number) {
  const text = value === null || value === undefined ? "" : String(value);
  if (text === "") return `<c r="${ref}" s="${style}"/>`;
  if (isPlainNumber(text)) return `<c r="${ref}" s="${style}"><v>${text}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

export async function buildXlsx(input: SheetInput): Promise<Uint8Array> {
  const cols = input.headers.length;
  const lines: string[] = [];
  let r = 0;
  input.titleLines.forEach((line, i) => {
    r += 1;
    lines.push(`<row r="${r}">${cell(`A${r}`, line, i === 0 ? 1 : 0)}</row>`);
  });
  if (input.titleLines.length) r += 1; // blank spacer row
  const headerRow = r + 1;
  r = headerRow;
  lines.push(`<row r="${r}">${input.headers.map((h, i) => cell(`${columnName(i)}${r}`, h, 2)).join("")}</row>`);
  for (const row of input.rows) {
    r += 1;
    lines.push(`<row r="${r}">${Array.from({ length: cols }, (_, i) => cell(`${columnName(i)}${r}`, row[i], 3)).join("")}</row>`);
  }

  // Column widths from content (capped), in Excel character units.
  const widths = input.headers.map((h, i) => {
    const longest = Math.max(String(h).length, ...input.rows.map((row) => String(row[i] ?? "").length));
    return Math.min(Math.max(longest + 2, 8), 45);
  });
  const lastCol = columnName(Math.max(cols - 1, 0));

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${lines.join("")}</sheetData>
${input.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${r}"/>` : ""}
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAE7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const sheetName = xmlText(input.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${
      input.rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$${headerRow}:$${lastCol}$${r}</definedName></definedNames>` : ""
    }</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/styles.xml", styles);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
