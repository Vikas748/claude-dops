"use client";
import { FormEvent, useEffect, useState } from "react";
import { formatDate, formatDateTime, localDate } from "@/lib/dates";
import { Columns3, Download, History, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
type R = {
  id: number;
  recordDate: string;
  primaryName: string;
  status: string;
  patientId: number | null;
  payload: Record<string, string>;
};
type CustomColumn = { id: number; name: string; dataType: "TEXT" | "NUMBER"; position: number };
type Version = { id: number; primaryName: string; status: string; payload: Record<string, string>; changedBy: string; createdAt: string };
const fields: { [k: string]: string[] } = {
  SKIN_RECIPIENT: [
    "CR No.",
    "UHID",
    "Age",
    "Sex",
    "Address",
    "Mobile No.",
    "Indication for Transplant",
    "Size of Graft Transplanted",
  ],
  SKIN_DONOR: [
    "Donor NOTTO ID",
    "Age",
    "Sex",
    "Address",
    "CR No.",
    "UHID",
    "Type of Death (BSD/DCD/NATURAL)",
    "Amount of Skin Retrieved",
    "Next of Kin Name",
    "Next of Kin Address",
    "Next of Kin Contact No.",
  ],
  LEPROSY: [
    "Age",
    "Sex",
    "Address",
    "Mobile No.",
    "Aadhaar Card No.",
    "Samagra ID",
    "Ayushman Card",
    "Diagnosis",
    "Date of Admission",
    "Date of Surgery",
    "Bank Account No.",
    "Bank Name",
    "Amount Released",
    "Amount",
  ],
  HELPLINE: ["Patient ID", "Diagnosis", "Mobile", "Address", "Ward / Bed", "Description", "Resolved At"],
};
const AGE_SEX = "Age/Sex";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC"];
/** "2026-10" -> "OCT 2026" */
const monthLabel = (value: string) => `${MONTHS[Number(value.slice(5, 7)) - 1] ?? ""} ${value.slice(0, 4)}`;
/** Last 36 months up to next month, always including the selected one. */
function monthOptions(selected: string) {
  const now = new Date(), out: string[] = [];
  for (let i = -1; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  if (!out.includes(selected)) out.push(selected);
  return out.sort().reverse();
}
/** "34 / F", like the OPD table. */
const ageSex = (p: Record<string, unknown>) => {
  const age = String(p.Age ?? "").trim(), sex = String(p.Sex ?? "").trim();
  return age || sex ? `${age || "—"} / ${sex ? sex[0].toUpperCase() : "—"}` : "—";
};

/** One Excel-style editable cell of the Skin Bank register. */
function InlineCell({ row, field, type = "text", editing, start, stop, save, strong }: {
  row: R; field: string; type?: string; editing: boolean; start: () => void; stop: () => void;
  save: (row: R, field: string, value: string | { age: string; sex: string }) => Promise<boolean | void>; strong?: boolean;
}) {
  const current = field === "recordDate" ? row.recordDate : field === "primaryName" ? row.primaryName : String(row.payload[field] ?? "");
  const [value, setValue] = useState(current);
  const [age, setAge] = useState(String(row.payload.Age ?? ""));
  const [sex, setSex] = useState(String(row.payload.Sex ?? ""));
  const [busy, setBusy] = useState(false);
  async function commit() {
    if (busy) return;
    const changed = field === AGE_SEX ? age !== String(row.payload.Age ?? "") || sex !== String(row.payload.Sex ?? "") : value !== current;
    if (!changed) return stop();
    setBusy(true);
    const ok = await save(row, field, field === AGE_SEX ? { age, sex } : value);
    setBusy(false);
    if (ok !== false) stop();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); void commit(); }
    if (e.key === "Escape") { setValue(current); setAge(String(row.payload.Age ?? "")); setSex(String(row.payload.Sex ?? "")); stop(); }
  }
  if (!editing) {
    const shown = field === "recordDate" ? formatDate(row.recordDate) : field === AGE_SEX ? ageSex(row.payload) : displayCell(current);
    return (
      <td className="cell-editable" tabIndex={0} role="button" aria-label={`Edit ${field === "primaryName" ? "name" : field === "recordDate" ? "date" : field} of ${row.primaryName}`}
        onClick={() => { setValue(current); setAge(String(row.payload.Age ?? "")); setSex(String(row.payload.Sex ?? "")); start(); }}
        onKeyDown={(e) => { if (e.key === "Enter") start(); }}>
        {strong ? <strong>{shown}</strong> : shown}
      </td>
    );
  }
  return (
    <td className="cell-editing">
      {field === AGE_SEX ? (
        <div className="cell-agesex" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) void commit(); }}>
          <input autoFocus inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} onKeyDown={onKey} aria-label="Age" disabled={busy} />
          <select value={sex} onChange={(e) => setSex(e.target.value)} onKeyDown={onKey} aria-label="Sex" disabled={busy}>
            <option value="">—</option><option>Male</option><option>Female</option><option>Other</option>
          </select>
        </div>
      ) : (
        <input autoFocus type={type} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => void commit()} onKeyDown={onKey} disabled={busy} aria-label={field} />
      )}
    </td>
  );
}

/** Register cell: dates shown as DD-MM-YYYY, empty as a dash. */
function displayCell(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "—";
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTime(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDate(text);
  return text;
}

export function SpecialModule({
  module,
  notify,
}: {
  module: string;
  notify: (m: string) => void;
}) {
  const [kind, setKind] = useState(
      module === "Skin Bank"
        ? "SKIN_RECIPIENT"
        : module === "Leprosy"
          ? "LEPROSY"
          : "HELPLINE",
    ),
    [rows, setRows] = useState<R[]>([]),
    [q, setQ] = useState(""),
    [statusFilter, setStatusFilter] = useState("ALL"),
    [month, setMonth] = useState(localDate().slice(0, 7)),
    [cellKey, setCellKey] = useState(""),
    [open, setOpen] = useState(false),
    [edit, setEdit] = useState<R | null>(null),
    [saving, setSaving] = useState(false),
    [customColumns, setCustomColumns] = useState<CustomColumn[]>([]),
    [columnOpen, setColumnOpen] = useState(false),
    [columnName, setColumnName] = useState(""),
    [columnType, setColumnType] = useState<"TEXT" | "NUMBER">("TEXT"),
    [history, setHistory] = useState<Version[] | null>(null);
  const reportMonth = /^\d{4}-\d{2}$/.test(month)
      ? month
      : new Date().toISOString().slice(0, 7),
    from = `${reportMonth}-01`,
    to = new Date(
      Number(reportMonth.slice(0, 4)),
      Number(reportMonth.slice(5, 7)),
      0,
    )
      .toISOString()
      .slice(0, 10),
    exportBase = `/api/special?kind=${kind}&from=${from}&to=${to}`;
  const totalFields = [...fields[kind], ...customColumns.map((column) => column.name)];
  // Skin Bank follows the official proforma, which has no status column.
  const isSkin = kind === "SKIN_RECIPIENT" || kind === "SKIN_DONOR";
  // Age and Sex are shown as one "Age/Sex" column, like OPD (the form keeps both fields).
  const tableFields = totalFields.includes("Age") && totalFields.includes("Sex")
    ? totalFields.filter((x) => x !== "Sex").map((x) => (x === "Age" ? AGE_SEX : x))
    : totalFields;

  // Excel-style editing (Skin Bank): tap a cell, type, press Enter or tap elsewhere to save.
  async function saveInline(row: R, field: string, value: string | { age: string; sex: string }) {
    const payload: Record<string, unknown> = { ...row.payload };
    let recordDate = row.recordDate, primaryName = row.primaryName;
    if (field === "recordDate") recordDate = String(value);
    else if (field === "primaryName") primaryName = String(value).trim();
    else if (field === AGE_SEX && typeof value === "object") { payload.Age = value.age; payload.Sex = value.sex; }
    else payload[field] = String(value);
    if (!primaryName || !recordDate) return notify("Name and date cannot be empty.");
    const r = await fetch("/api/special", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, kind, patientId: row.patientId ?? null, recordDate, primaryName, status: row.status, payload }),
      }),
      j = await r.json();
    if (!r.ok) {
      notify(j.message ?? "Could not save the change.");
      return false;
    }
    await load();
    return true;
  }
  const visibleRows = kind === "HELPLINE" && statusFilter !== "ALL" ? rows.filter((row) => row.status === statusFilter) : rows;
  const load = async () => {
    const r = await fetch(
        `/api/special?kind=${kind}&q=${encodeURIComponent(q)}&from=${from}&to=${to}`,
        { cache: "no-store" },
      ),
      j = await r.json();
    if (r.ok) setRows(j.data);
    else notify(j.message);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Search and reporting filters define this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, q, month]);
  useEffect(() => {
    if (!kind.startsWith("SKIN_")) return;
    void fetch(`/api/special/columns?kind=${kind}`, { cache: "no-store" }).then((response) => response.json()).then((result) => result.success && setCustomColumns(result.data));
  }, [kind]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget),
      payload: Record<string, string> = Object.fromEntries(
        totalFields.map((x) => [x, String(f.get(x) ?? "")]),
      );
    const body = {
      id: edit?.id,
      kind,
      patientId: edit?.patientId ?? null,
      recordDate: f.get("recordDate"),
      primaryName: f.get("primaryName"),
      status: f.get("status"),
      payload,
    };
    const r = await fetch("/api/special", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      j = await r.json();
    setSaving(false);
    if (!r.ok) return notify(j.message);
    setOpen(false);
    setEdit(null);
    await load();
    notify("Register updated.");
  }
  async function addColumn() {
    const r = await fetch("/api/special/columns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name: columnName, dataType: columnType }) }), j = await r.json();
    if (!r.ok) return notify(j.message);
    setColumnOpen(false); setColumnName("");
    const refreshed = await fetch(`/api/special/columns?kind=${kind}`, { cache: "no-store" }).then((response) => response.json());
    if (refreshed.success) setCustomColumns(refreshed.data);
    notify("Custom column added.");
  }
  async function removeColumn(id: number) {
    if (!confirm("Remove this custom column? Existing historical values will remain in version history.")) return;
    const r = await fetch(`/api/special/columns?id=${id}`, { method: "DELETE" }), j = await r.json();
    if (!r.ok) return notify(j.message);
    setCustomColumns((items) => items.filter((item) => item.id !== id));
    notify("Custom column removed.");
  }
  async function showHistory(id: number) {
    const r = await fetch(`/api/special/columns?historyId=${id}`, { cache: "no-store" }), j = await r.json();
    if (!r.ok) return notify(j.message);
    setHistory(j.data);
  }
  const leprosyReleased = rows.filter((row) => row.payload["Amount Released"] === "YES");
  async function remove(id: number) {
    if (!confirm("Remove this row?")) return;
    await fetch(`/api/special?id=${id}`, { method: "DELETE" });
    await load();
  }
  return (
    <>
      <section className="welcome-row">
        <div>
          <h1 className="section-title">{module}</h1>
          <p>
            {kind === "HELPLINE"
              ? "Cases are added from the Ward. Update status and notes here."
              : "Spreadsheet-style monthly departmental register."}
          </p>
        </div>
        <div className="row-actions">
          <Button asChild variant="outline">
            <a href={`${exportBase}&format=xlsx`}>
              <Download /> Export Excel
            </a>
          </Button>
          {module === "Skin Bank" && <Button variant="outline" onClick={() => setColumnOpen(true)}><Columns3 /> Manage Columns</Button>}
          <Button asChild variant="outline">
            <a href={`${exportBase}&format=csv`}>
              <Download /> Export CSV
            </a>
          </Button>
          {kind !== "HELPLINE" && (
            <Button
              onClick={() => {
                setEdit(null);
                setOpen(true);
              }}
            >
              <Plus /> Add Row
            </Button>
          )}
        </div>
      </section>
      {module === "Skin Bank" && (
        <Tabs value={kind} onValueChange={setKind}>
          <TabsList>
            <TabsTrigger value="SKIN_RECIPIENT" className="skin-tab skin-tab-recipient">RECIPIENTS</TabsTrigger>
            <TabsTrigger value="SKIN_DONOR" className="skin-tab skin-tab-donor">DONORS</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <section className="search-wrap">
        <Search />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search register…"
        />
        <select
          className="register-month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Report month"
        >
          {monthOptions(month).map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        {kind === "HELPLINE" && <select className="register-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="CM Helpline status"><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="RESOLVED">Resolved</option></select>}
      </section>
      {kind === "HELPLINE" && (
        <section className="register-summary" aria-label="CM Helpline summary">
          <article><span>Total cases</span><strong>{rows.length}</strong></article>
          <article><span>Pending</span><strong>{rows.filter((row) => row.status === "PENDING").length}</strong></article>
          <article><span>Resolved</span><strong>{rows.filter((row) => row.status === "RESOLVED").length}</strong></article>
        </section>
      )}
      {kind === "LEPROSY" && (
        <section className="register-summary" aria-label="Leprosy monthly summary">
          <article><span>Total records</span><strong>{rows.length}</strong></article>
          <article><span>Release pending</span><strong>{rows.length - leprosyReleased.length}</strong></article>
        </section>
      )}
      <article className="panel opd-panel">
        <div className="register-banner">
          <strong>
            {module === "Skin Bank"
              ? "JABALPUR SKIN BANK"
              : module.toUpperCase()}
          </strong>
          <span>
            Department of Burn & Plastic Surgery, NSCB Medical College Jabalpur
            · Madhya Pradesh · Monthly reporting period: {from} to {to}
          </span>
        </div>
        <div className="table-scroll">
          <table className="opd-table special-table">
            <thead>
              <tr>
                <th>S No</th>
                <th>Date</th>
                <th>Name</th>
                {tableFields.map((x) => (
                  <th key={x}>{x}</th>
                ))}
                {!isSkin && <th>Status</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  {isSkin ? <>
                    <InlineCell row={r} field="recordDate" type="date" editing={cellKey === `${r.id}:recordDate`} start={() => setCellKey(`${r.id}:recordDate`)} stop={() => setCellKey("")} save={saveInline} />
                    <InlineCell row={r} field="primaryName" editing={cellKey === `${r.id}:primaryName`} start={() => setCellKey(`${r.id}:primaryName`)} stop={() => setCellKey("")} save={saveInline} strong />
                    {tableFields.map((x) => (
                      <InlineCell key={x} row={r} field={x} editing={cellKey === `${r.id}:${x}`} start={() => setCellKey(`${r.id}:${x}`)} stop={() => setCellKey("")} save={saveInline} />
                    ))}
                  </> : <>
                  <td>{formatDate(r.recordDate)}</td>
                  <td>
                    <strong>{r.primaryName}</strong>
                  </td>
                  {tableFields.map((x) => (
                    <td key={x}>{x === AGE_SEX ? ageSex(r.payload) : displayCell(r.payload[x])}</td>
                  ))}
                  </>}
                  {!isSkin && (
                    <td>
                      <span className="clinical-badge active">{r.status}</span>
                    </td>
                  )}
                  <td>
                    <div className="row-actions">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Edit ${r.primaryName}`}
                        onClick={() => {
                          setEdit(r);
                          setOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      {(kind.startsWith("SKIN_") || kind === "LEPROSY") && <Button variant="ghost" size="icon-sm" aria-label="View row version history" onClick={() => void showHistory(r.id)}><History /></Button>}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${r.primaryName}`}
                        onClick={() => remove(r.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visibleRows.length && (
          <div className="empty-state">
            <Plus />
            <h3>{kind === "HELPLINE" && rows.length ? "No cases match this status" : "No rows yet"}</h3>
            <p>{kind === "HELPLINE" ? "Add a case from the Ward using the CM Helpline button." : "Add the first record to this register."}</p>
          </div>
        )}
      </article>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{kind === "HELPLINE" ? (edit ? "Update CM Helpline case" : "Link patient to CM Helpline") : `${edit ? "Edit" : "Add"} register row`}</DialogTitle>
            <DialogDescription>
              All changes are saved with an audit trail.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <div className="dialog-fields grid-2">
              <label>
                {kind === "SKIN_RECIPIENT"
                  ? "Date of Surgery"
                  : kind === "SKIN_DONOR"
                    ? "Date of Retrieval"
                    : "Record Date"}
                <Input
                  type="date"
                  name="recordDate"
                  required
                  defaultValue={edit?.recordDate}
                />
              </label>
              {kind === "HELPLINE" ? (
                <label>
                  Patient
                  {/* The patient is fixed by the Ward case and cannot be changed here. */}
                  <Input name="primaryName" defaultValue={edit?.primaryName ?? ""} readOnly />
                </label>
              ) : (
                <label>
                  {kind === "SKIN_DONOR" ? "Donor name" : "Patient name"}
                  <Input
                    name="primaryName"
                    required
                    defaultValue={edit?.primaryName}
                  />
                </label>
              )}
              {totalFields.map((x) => (
                <label key={x}>
                  {x}
                  {x === "Sex" ? (
                    <select name={x} defaultValue={edit?.payload[x] ?? ""}>
                      <option value="">Select</option>
                      <option>Male</option>
                      <option>Female</option>
                      <option>Other</option>
                    </select>
                  ) : x.startsWith("Type of Death") ? (
                    <select name={x} defaultValue={edit?.payload[x] ?? ""}>
                      <option value="">Select</option>
                      <option>BSD</option>
                      <option>DCD</option>
                      <option>NATURAL</option>
                    </select>
                  ) : x === "Amount Released" ? (
                    <select name={x} defaultValue={edit?.payload[x] ?? "NO"}>
                      <option>NO</option>
                      <option>YES</option>
                    </select>
                  ) : (
                    <Input
                      name={x}
                      type={
                        customColumns.find((column) => column.name === x)?.dataType === "NUMBER"
                          ? "number"
                          : x.startsWith("Date of")
                          ? "date"
                          : x === "Age" || x === "Amount"
                            ? "number"
                            : "text"
                      }
                      inputMode={x === "Mobile No." || x === "Aadhaar Card No." || x === "Bank Account No." ? "numeric" : undefined}
                      maxLength={x === "Mobile No." ? 10 : x === "Aadhaar Card No." ? 12 : undefined}
                      min={x === "Age" || x === "Amount" ? 0 : undefined}
                      readOnly={kind === "HELPLINE" && x !== "Description"}
                      defaultValue={edit?.payload[x]}
                    />
                  )}
                </label>
              ))}
              {isSkin ? <input type="hidden" name="status" value={edit?.status ?? "ACTIVE"} /> : <label>
                Status
                <select
                  name="status"
                  defaultValue={
                    edit?.status ?? (kind === "HELPLINE" ? "PENDING" : "ACTIVE")
                  }
                >
                  {kind === "HELPLINE" ? <><option value="PENDING">Pending</option><option value="RESOLVED">Resolved</option></> : <><option>ACTIVE</option><option>PENDING</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>RELEASED</option></>}
                </select>
              </label>}
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={saving}>
                {saving ? "Saving…" : "Save Row"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={columnOpen} onOpenChange={setColumnOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manage Skin Bank columns</DialogTitle><DialogDescription>Official proforma columns are protected. Add or remove supplementary columns below.</DialogDescription></DialogHeader>
          <div className="custom-column-list">{customColumns.map((column) => <div key={column.id}><span><strong>{column.name}</strong><small>{column.dataType}</small></span><Button variant="ghost" size="icon-sm" onClick={() => void removeColumn(column.id)}><Trash2 /></Button></div>)}</div>
          <div className="dialog-fields grid-2"><label>New column name<Input value={columnName} onChange={(event) => setColumnName(event.target.value)} /></label><label>Data type<select value={columnType} onChange={(event) => setColumnType(event.target.value as typeof columnType)}><option value="TEXT">Text</option><option value="NUMBER">Number</option></select></label></div>
          <DialogFooter><Button variant="outline" onClick={() => setColumnOpen(false)}>Close</Button><Button disabled={!columnName.trim()} onClick={() => void addColumn()}><Plus /> Add Column</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={history !== null} onOpenChange={(value) => !value && setHistory(null)}>
        <DialogContent><DialogHeader><DialogTitle>Row version history</DialogTitle><DialogDescription>Previous values captured before every edit or delete.</DialogDescription></DialogHeader><div className="version-list">{history?.map((version) => <article key={version.id}><strong>{formatDateTime(version.createdAt)}</strong><span>{version.primaryName} · {version.status}</span><small>{version.changedBy}</small><pre>{JSON.stringify(version.payload, null, 2)}</pre></article>)}{history?.length === 0 && <p>No earlier versions yet.</p>}</div></DialogContent>
      </Dialog>
    </>
  );
}
