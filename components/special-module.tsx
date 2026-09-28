"use client";
import { FormEvent, useEffect, useState } from "react";
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
type P = {
  id: number;
  patientCode: string;
  name: string;
  diagnosis: string;
  mobile: string;
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
  HELPLINE: ["Diagnosis", "Mobile", "Address", "Source", "Source Record", "Description", "Resolved At"],
};
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
    [patients, setPatients] = useState<P[]>([]),
    [q, setQ] = useState(""),
    [statusFilter, setStatusFilter] = useState("ALL"),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [open, setOpen] = useState(false),
    [edit, setEdit] = useState<R | null>(null),
    [saving, setSaving] = useState(false),
    [customColumns, setCustomColumns] = useState<CustomColumn[]>([]),
    [columnOpen, setColumnOpen] = useState(false),
    [columnName, setColumnName] = useState(""),
    [columnType, setColumnType] = useState<"TEXT" | "NUMBER">("TEXT"),
    [history, setHistory] = useState<Version[] | null>(null),
    [formulaField, setFormulaField] = useState(""),
    [formulaOperation, setFormulaOperation] = useState<"SUM" | "AVERAGE" | "COUNT">("SUM");
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
  useEffect(() => {
    if (kind === "HELPLINE")
      fetch("/api/patients", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => j.success && setPatients(j.data));
  }, [kind]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget),
      payload: Record<string, string> = Object.fromEntries(
        totalFields.map((x) => [x, String(f.get(x) ?? "")]),
      );
    const patient = patients.find((p) => p.id === Number(f.get("patientId")));
    if (patient)
      Object.assign(payload, {
        Diagnosis: patient.diagnosis,
        Mobile: patient.mobile,
        Source: "OPD/IPD",
      });
    const body = {
      id: edit?.id,
      kind,
      patientId: patient?.id || null,
      recordDate: f.get("recordDate"),
      primaryName: patient?.name || f.get("primaryName"),
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
  const numericFields = [...new Set(["Age", "Amount", "Amount of Skin Retrieved", "Size of Graft Transplanted", ...customColumns.filter((column) => column.dataType === "NUMBER").map((column) => column.name)])].filter((field) => totalFields.includes(field));
  const formulaValues = rows.map((row) => Number(row.payload[formulaField])).filter(Number.isFinite);
  const formulaResult = formulaOperation === "COUNT" ? formulaValues.length : formulaOperation === "AVERAGE" ? (formulaValues.length ? formulaValues.reduce((sum, value) => sum + value, 0) / formulaValues.length : 0) : formulaValues.reduce((sum, value) => sum + value, 0);
  const leprosyReleased = rows.filter((row) => row.payload["Amount Released"] === "YES");
  const leprosyReleasedAmount = leprosyReleased.reduce((sum, row) => sum + (Number(row.payload.Amount) || 0), 0);
  async function remove(id: number) {
    if (!confirm("Remove this row?")) return;
    await fetch(`/api/special?id=${id}`, { method: "DELETE" });
    await load();
  }
  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">SPECIAL REGISTERS</p>
          <h1>{module}</h1>
          <p>
            {kind === "HELPLINE"
              ? "Link existing OPD/IPD patients without entering demographics again."
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
          <Button
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus /> {kind === "HELPLINE" ? "Link Patient" : "Add Row"}
          </Button>
        </div>
      </section>
      {module === "Skin Bank" && (
        <Tabs value={kind} onValueChange={setKind}>
          <TabsList>
            <TabsTrigger value="SKIN_RECIPIENT">Recipients</TabsTrigger>
            <TabsTrigger value="SKIN_DONOR">Donors</TabsTrigger>
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
        <Input
          className="register-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Report month"
        />
        {kind === "HELPLINE" && <select className="register-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="CM Helpline status"><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option></select>}
      </section>
      {kind === "HELPLINE" && (
        <section className="register-summary" aria-label="CM Helpline summary">
          <article><span>Total cases</span><strong>{rows.length}</strong></article>
          <article><span>Pending</span><strong>{rows.filter((row) => row.status === "PENDING").length}</strong></article>
          <article><span>In progress</span><strong>{rows.filter((row) => row.status === "IN_PROGRESS").length}</strong></article>
          <article><span>Resolved</span><strong>{rows.filter((row) => row.status === "RESOLVED").length}</strong></article>
        </section>
      )}
      {kind === "LEPROSY" && (
        <section className="register-summary" aria-label="Leprosy monthly summary">
          <article><span>Total records</span><strong>{rows.length}</strong></article>
          <article><span>Amount released</span><strong>{leprosyReleased.length}</strong></article>
          <article><span>Release pending</span><strong>{rows.length - leprosyReleased.length}</strong></article>
          <article><span>Total released value</span><strong>₹{leprosyReleasedAmount.toLocaleString("en-IN")}</strong></article>
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
                {totalFields.map((x) => (
                  <th key={x}>{x}</th>
                ))}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{r.recordDate}</td>
                  <td>
                    <strong>{r.primaryName}</strong>
                  </td>
                  {totalFields.map((x) => (
                    <td key={x}>{r.payload[x] || "—"}</td>
                  ))}
                  <td>
                    <span className="clinical-badge active">{r.status}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button
                        variant="outline"
                        size="icon-sm"
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
            <p>{kind === "HELPLINE" ? "Link a patient from OPD or IPD to start tracking." : "Add the first record to this register."}</p>
          </div>
        )}
      </article>
      {(module === "Skin Bank" || kind === "LEPROSY") && numericFields.length > 0 && (
        <section className="register-formula panel">
          <strong>Basic formula</strong>
          <select value={formulaField} onChange={(event) => setFormulaField(event.target.value)}><option value="">Select numeric column</option>{numericFields.map((field) => <option key={field}>{field}</option>)}</select>
          <select value={formulaOperation} onChange={(event) => setFormulaOperation(event.target.value as typeof formulaOperation)}><option>SUM</option><option>AVERAGE</option><option>COUNT</option></select>
          <span>{formulaField ? `${formulaOperation}(${formulaField}) = ${Number.isInteger(formulaResult) ? formulaResult : formulaResult.toFixed(2)}` : "Choose a column"}</span>
        </section>
      )}
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
                  <select
                    name="patientId"
                    required
                    defaultValue={edit?.patientId ?? ""}
                  >
                    <option value="">Select OPD/IPD patient</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.patientCode} — {p.name}
                      </option>
                    ))}
                  </select>
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
              <label>
                Status
                <select
                  name="status"
                  defaultValue={
                    edit?.status ?? (kind === "HELPLINE" ? "PENDING" : "ACTIVE")
                  }
                >
                  {kind === "HELPLINE" ? <><option value="PENDING">PENDING</option><option value="IN_PROGRESS">IN PROGRESS</option><option value="RESOLVED">RESOLVED</option></> : <><option>ACTIVE</option><option>PENDING</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>RELEASED</option></>}
                </select>
              </label>
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
        <DialogContent><DialogHeader><DialogTitle>Row version history</DialogTitle><DialogDescription>Previous values captured before every edit or delete.</DialogDescription></DialogHeader><div className="version-list">{history?.map((version) => <article key={version.id}><strong>{new Date(version.createdAt).toLocaleString("en-IN")}</strong><span>{version.primaryName} · {version.status}</span><small>{version.changedBy}</small><pre>{JSON.stringify(version.payload, null, 2)}</pre></article>)}{history?.length === 0 && <p>No earlier versions yet.</p>}</div></DialogContent>
      </Dialog>
    </>
  );
}
