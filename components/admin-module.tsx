"use client";
import { FormEvent, useEffect, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/dates";
import JSZip from "jszip";
import { putToSignedUrl } from "@/lib/direct-upload";
import { Activity, CheckCircle2, ClipboardCheck, Database, Download, HardDrive, Plus, RefreshCw, RotateCcw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
const modules = [
  "OPD",
  "IPD",
  "WARD",
  "OT",
  "CLASS",
  "SKIN_BANK",
  "RESEARCH",
  "PUBLICATION",
  "LEPROSY",
  "CM_HELPLINE",
];
const actions = ["VIEW", "CREATE", "EDIT", "DELETE", "EXPORT"] as const;
type U = {
  id: number;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status: string;
  permissions: string[];
};
type L = {
  id: number;
  action: string;
  module: string;
  details: string;
  createdAt: string;
};
type SystemHealth = {
  database: string;
  storage: string;
  checkedAt: string;
  lastBackupAt: string | null;
  counts: Record<string, number>;
};
type RecoverySnapshot = {
  format: string;
  schemaVersion: number;
  exportedAt: string;
  files: { key: string; name: string; contentType: string }[];
  data: Record<string, Record<string, unknown>[]>;
};
type UatCheck = {
  id: string;
  area: string;
  tester: string;
  title: string;
  steps: readonly string[];
  expected: string;
  status: "NOT_TESTED" | "PASS" | "FAIL" | "BLOCKED";
  notes: string;
  testedBy: string | null;
  testedAt: string | null;
};
type UatSummary = { total: number; passed: number; failed: number; blocked: number; pending: number; readyForSignOff: boolean };
type Acceptance = { departmentRepresentative: string; itRepresentative: string; decision: "APPROVED" | "CONDITIONAL" | "REJECTED"; limitations: string; acceptedBy: string; acceptedAt: string };
export function AdminModule({ notify }: { notify: (m: string) => void }) {
  const [users, setUsers] = useState<U[]>([]),
    [logs, setLogs] = useState<L[]>([]),
    [me, setMe] = useState<{ role: string; status: string } | null>(null),
    [open, setOpen] = useState(false),
    [edit, setEdit] = useState<U | null>(null),
    [health, setHealth] = useState<SystemHealth | null>(null),
    [healthLoading, setHealthLoading] = useState(false),
    [backingUp, setBackingUp] = useState(false),
    [backupProgress, setBackupProgress] = useState(""),
    [restorePackage, setRestorePackage] = useState<{ zip: JSZip; snapshot: RecoverySnapshot; name: string } | null>(null),
    [restorePhrase, setRestorePhrase] = useState(""),
    [restoreOpen, setRestoreOpen] = useState(false),
    [restoring, setRestoring] = useState(false),
    [uatChecks, setUatChecks] = useState<UatCheck[]>([]),
    [uatSummary, setUatSummary] = useState<UatSummary | null>(null),
    [uatLoading, setUatLoading] = useState(false),
    [uatSaving, setUatSaving] = useState<string | null>(null),
    [acceptance, setAcceptance] = useState<Acceptance | null>(null),
    [acceptanceForm, setAcceptanceForm] = useState({ departmentRepresentative: "", itRepresentative: "", decision: "CONDITIONAL", limitations: "" }),
    [acceptanceSaving, setAcceptanceSaving] = useState(false);
  const load = async () => {
    const r = await fetch("/api/admin", { cache: "no-store" }),
      j = await r.json();
    if (!r.ok) return notify(j.message);
    setMe(j.data.me);
    setUsers(j.data.users);
    setLogs(j.data.logs);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void Promise.all([load(), loadUat()]), 0);
    return () => window.clearTimeout(timer);
    // Admin and UAT data are intentionally loaded once when this module mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function loadHealth() {
    setHealthLoading(true);
    try {
      const r = await fetch("/api/admin/system", { cache: "no-store" }),
        j = await r.json();
      if (!r.ok) return notify(j.message);
      setHealth(j.data);
    } finally {
      setHealthLoading(false);
    }
  }
  async function loadUat() {
    setUatLoading(true);
    try {
      const r = await fetch("/api/admin/uat", { cache: "no-store" }), j = await r.json();
      if (!r.ok) return notify(j.message);
      setUatChecks(j.data.checks);
      setUatSummary(j.data.summary);
      setAcceptance(j.data.acceptance);
      if (j.data.acceptance) setAcceptanceForm({ departmentRepresentative: j.data.acceptance.departmentRepresentative, itRepresentative: j.data.acceptance.itRepresentative, decision: j.data.acceptance.decision, limitations: j.data.acceptance.limitations });
    } finally {
      setUatLoading(false);
    }
  }
  async function saveAcceptance() {
    setAcceptanceSaving(true);
    try {
      const r = await fetch("/api/admin/uat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "acceptance", ...acceptanceForm }) }), j = await r.json();
      if (!r.ok) return notify(j.message);
      await Promise.all([loadUat(), load()]);
      notify("Hospital acceptance record saved.");
    } finally { setAcceptanceSaving(false); }
  }
  async function saveUat(check: UatCheck) {
    setUatSaving(check.id);
    try {
      const r = await fetch("/api/admin/uat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: check.id, status: check.status, notes: check.notes }),
      }), j = await r.json();
      if (!r.ok) return notify(j.message);
      await Promise.all([loadUat(), load()]);
      notify(`${check.id} result saved.`);
    } finally {
      setUatSaving(null);
    }
  }
  async function downloadBackup() {
    setBackingUp(true);
    setBackupProgress("Reading database…");
    try {
      const r = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "backup" }),
      });
      if (!r.ok) {
        const j = await r.json();
        return notify(j.message);
      }
      // The server saves the database export in private storage and returns a
      // short-lived link, so large databases are not limited by request size.
      const response = await r.json();
      setBackupProgress("Downloading database…");
      const exported = await fetch(String(response.data.url), { cache: "no-store" });
      if (!exported.ok) throw new Error("Database export could not be downloaded. Try again.");
      const snapshot = (await exported.json()) as RecoverySnapshot,
        zip = new JSZip();
      zip.file("database.json", JSON.stringify(snapshot, null, 2));
      for (let index = 0; index < snapshot.files.length; index += 1) {
        const file = snapshot.files[index];
        setBackupProgress(`Adding files ${index + 1}/${snapshot.files.length}…`);
        const fileResponse = await fetch(`/api/admin/system?file=${encodeURIComponent(file.key)}`, { cache: "no-store" });
        if (!fileResponse.ok) throw new Error(`Could not include ${file.name}.`);
        zip.file(`files/${file.key}`, await fileResponse.blob());
      }
      setBackupProgress("Creating recovery package…");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }),
        filename = `dops-recovery-${formatDate(snapshot.exportedAt)}.zip`,
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      await Promise.all([load(), loadHealth()]);
      notify(`Recovery package downloaded with ${snapshot.files.length} uploaded file(s).`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Backup package could not be created.");
    } finally {
      setBackingUp(false);
      setBackupProgress("");
    }
  }
  async function selectRestorePackage(file: File) {
    try {
      const zip = await JSZip.loadAsync(file), entry = zip.file("database.json");
      if (!entry) throw new Error("database.json is missing from this package.");
      const snapshot = JSON.parse(await entry.async("text")) as RecoverySnapshot;
      if (snapshot.format !== "DOPS_RECOVERY_PACKAGE" || snapshot.schemaVersion !== 1 || !snapshot.data || !Array.isArray(snapshot.files)) throw new Error("This is not a valid DOPS recovery package.");
      for (const item of snapshot.files) if (!zip.file(`files/${item.key}`)) throw new Error(`Package is missing ${item.name}.`);
      setRestorePackage({ zip, snapshot, name: file.name });
      setRestorePhrase("");
      notify("Recovery package validated. Review it before restore.");
    } catch (error) {
      setRestorePackage(null);
      notify(error instanceof Error ? error.message : "Package validation failed.");
    }
  }
  async function restoreBackup() {
    if (!restorePackage) return;
    setRestoring(true);
    try {
      const { zip, snapshot } = restorePackage;
      for (let index = 0; index < snapshot.files.length; index += 1) {
        const item = snapshot.files[index], entry = zip.file(`files/${item.key}`);
        if (!entry) throw new Error(`Package is missing ${item.name}.`);
        // Each file goes straight back to storage at its original location.
        const sign = await fetch("/api/admin/system", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "restoreFileUrl", key: item.key }),
        }), signed = await sign.json();
        if (!sign.ok) throw new Error(signed.message ?? `Could not restore ${item.name}.`);
        await putToSignedUrl(signed.data.uploadUrl, await entry.async("arraybuffer"), item.contentType);
      }
      // Then the database itself: uploaded to storage, and the server reads it from there.
      const packageBytes = new TextEncoder().encode(JSON.stringify(snapshot));
      const pkg = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restorePackageUrl", size: packageBytes.byteLength }),
      }), pkgJson = await pkg.json();
      if (!pkg.ok) throw new Error(pkgJson.message ?? "Restore could not start.");
      await putToSignedUrl(pkgJson.data.uploadUrl, packageBytes.buffer as ArrayBuffer, "application/json");
      const r = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore", uploadId: pkgJson.data.uploadId }),
      }), j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setRestoreOpen(false);
      setRestorePackage(null);
      setRestorePhrase("");
      await Promise.all([load(), loadHealth()]);
      notify("DOPS data and uploaded files restored successfully.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setRestoring(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      permissions = modules.flatMap((module) =>
        actions
          .filter((action) => f.get(`${module}:${action}`) === "on")
          .map((action) => `${module}:${action}`),
      ),
      body = {
        id: edit?.id,
        name: f.get("name"),
        email: f.get("email"),
        mobile: f.get("mobile"),
        role: f.get("role"),
        status: f.get("status"),
        permissions,
      };
    const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      j = await r.json();
    if (!r.ok) return notify(j.message);
    setOpen(false);
    setEdit(null);
    await load();
    notify("User access updated.");
  }
  if (me && me.role !== "ADMIN")
    return (
      <div className="panel empty-state">
        <ShieldCheck />
        <h3>Access awaiting approval</h3>
        <p>
          Your account status is {me.status}. An administrator must approve
          module access.
        </p>
      </div>
    );
  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">ACCESS CONTROL</p>
          <h1>Administration</h1>
          <p>Approve users, assign roles and control every module action.</p>
        </div>
        <Button
          onClick={() => {
            setEdit(null);
            setOpen(true);
          }}
        >
          <Plus /> Add User
        </Button>
      </section>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="system" onClick={() => void loadHealth()}>System Health</TabsTrigger>
          <TabsTrigger value="uat" onClick={() => void loadUat()}>Hospital UAT</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <article className="panel opd-panel">
            <div className="auth-posture">
              <ShieldCheck />
              <div><strong>Passwordless identity verified</strong><span>New users remain pending until an Admin approves their role and module permissions. No DOPS passwords are stored.</span></div>
            </div>
            <div className="table-scroll">
              <table className="opd-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Action permissions</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                        <small>{u.email}</small>
                      </td>
                      <td>{u.role}</td>
                      <td>
                        <span
                          className={`clinical-badge ${u.status.toLowerCase()}`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td>
                        {u.role === "ADMIN"
                          ? "All modules"
                          : `${u.permissions.length} granted`}
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEdit(u);
                            setOpen(true);
                          }}
                        >
                          Manage
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </TabsContent>
        <TabsContent value="audit">
          <article className="panel audit-list">
            {logs.map((l) => (
              <div key={l.id}>
                <span className="clinical-badge">{l.module}</span>
                <strong>{l.action}</strong>
                <p>{l.details}</p>
                <time>{formatDateTime(l.createdAt)}</time>
              </div>
            ))}
          </article>
        </TabsContent>
        <TabsContent value="system">
          <article className="panel system-panel">
            <div className="system-heading">
              <div>
                <p className="eyebrow">PRODUCTION READINESS</p>
                <h2>System health & backup</h2>
                <p>Review core services and download a complete database snapshot.</p>
              </div>
              <Button variant="outline" onClick={() => void loadHealth()} disabled={healthLoading}>
                <RefreshCw className={healthLoading ? "spin" : ""} /> Refresh status
              </Button>
            </div>
            <div className="health-grid">
              <div><span><Database /></span><small>Patient database</small><strong>{health?.database ?? "Checking…"}</strong></div>
              <div><span><HardDrive /></span><small>Document storage</small><strong>{health?.storage ?? "Checking…"}</strong></div>
              <div><span><Activity /></span><small>Last health check</small><strong>{health ? formatDateTime(health.checkedAt) : "—"}</strong></div>
            </div>
            <div className="backup-card">
              <div className="backup-icon"><Download /></div>
              <div>
                <h3>Download complete recovery package</h3>
                <p>Creates one ZIP containing the full database, discharge cards, academic PDFs and OT images.</p>
                <small>Last backup: {health?.lastBackupAt ? formatDateTime(health.lastBackupAt) : "No backup recorded yet"}</small>
              </div>
              <Button onClick={() => void downloadBackup()} disabled={backingUp}>
                <Download /> {backingUp ? backupProgress || "Preparing…" : "Download ZIP"}
              </Button>
            </div>
            <div className="restore-card">
              <div className="backup-icon restore"><RotateCcw /></div>
              <div>
                <h3>Restore from recovery package</h3>
                <p>Validate a DOPS ZIP package before replacing current database records and restoring its files.</p>
                {restorePackage && <small>Ready: {restorePackage.name} · {restorePackage.snapshot.files.length} file(s) · exported {formatDateTime(restorePackage.snapshot.exportedAt)}</small>}
              </div>
              <label className="restore-picker">
                <Upload /> Select ZIP
                <input type="file" accept=".zip,application/zip" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectRestorePackage(file);
                  event.target.value = "";
                }} />
              </label>
              {restorePackage && (
                <div className="restore-confirm">
                  <label>Type <b>RESTORE DOPS</b> to continue<Input value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} /></label>
                  <Button variant="destructive" disabled={restorePhrase !== "RESTORE DOPS"} onClick={() => setRestoreOpen(true)}><RotateCcw /> Review restore</Button>
                </div>
              )}
            </div>
            {health && (
              <div className="record-summary">
                <strong>Backup coverage</strong>
                <div>{Object.entries(health.counts).map(([table, count]) => <span key={table}><b>{count}</b>{table.replaceAll("_", " ")}</span>)}</div>
              </div>
            )}
            <div className="security-posture">
              <div><ShieldCheck /><span><strong>Protected file access</strong><small>Every PDF, card and OT image requires its module permission.</small></span></div>
              <div><ShieldCheck /><span><strong>Trusted mutations</strong><small>Cross-site writes, oversized requests and rapid repeated actions are blocked.</small></span></div>
              <div><ShieldCheck /><span><strong>Attributed audit trail</strong><small>New clinical and administrative actions record user ID and role.</small></span></div>
            </div>
          </article>
        </TabsContent>
        <TabsContent value="uat">
          <article className="panel uat-panel">
            <div className="system-heading">
              <div>
                <p className="eyebrow">USER ACCEPTANCE TESTING</p>
                <h2>Hospital UAT checklist</h2>
                <p>Test with dummy patient data. Production sign-off is ready only after every check passes.</p>
              </div>
              <div className="uat-actions">
                <Button variant="outline" asChild><a href="/api/admin/uat?format=csv"><Download /> Download evidence</a></Button>
                <Button variant="outline" onClick={() => void loadUat()} disabled={uatLoading}><RefreshCw className={uatLoading ? "spin" : ""} /> Refresh</Button>
              </div>
            </div>
            {uatSummary && (
              <div className={`uat-summary ${uatSummary.readyForSignOff ? "ready" : ""}`}>
                <div><ClipboardCheck /><span><strong>{uatSummary.passed}/{uatSummary.total}</strong><small>checks passed</small></span></div>
                <div className="uat-progress"><span style={{ width: `${Math.round((uatSummary.passed / uatSummary.total) * 100)}%` }} /></div>
                <div className="uat-counts"><span>{uatSummary.pending} pending</span><span>{uatSummary.failed} failed</span><span>{uatSummary.blocked} blocked</span></div>
                <b>{uatSummary.readyForSignOff ? "READY FOR HOSPITAL SIGN-OFF" : "UAT IN PROGRESS"}</b>
              </div>
            )}
            {uatSummary && (
              <section className={`acceptance-card ${acceptance?.decision?.toLowerCase() ?? ""}`}>
                <div className="acceptance-heading">
                  <div><ShieldCheck /><span><small>FINAL ACCEPTANCE</small><h3>{acceptance ? `Hospital decision: ${acceptance.decision}` : "Record hospital sign-off"}</h3></span></div>
                  {acceptance?.acceptedAt && <small>Recorded {formatDateTime(acceptance.acceptedAt)} by {acceptance.acceptedBy}</small>}
                </div>
                <div className="acceptance-grid">
                  <label>Department representative<Input value={acceptanceForm.departmentRepresentative} onChange={(event) => setAcceptanceForm((form) => ({ ...form, departmentRepresentative: event.target.value }))} /></label>
                  <label>Hospital IT / Security representative<Input value={acceptanceForm.itRepresentative} onChange={(event) => setAcceptanceForm((form) => ({ ...form, itRepresentative: event.target.value }))} /></label>
                  <label>Decision<select value={acceptanceForm.decision} onChange={(event) => setAcceptanceForm((form) => ({ ...form, decision: event.target.value }))}><option value="APPROVED" disabled={!uatSummary.readyForSignOff}>Approved</option><option value="CONDITIONAL">Conditional</option><option value="REJECTED">Rejected</option></select></label>
                  <label className="span-2">Open limitations / conditions<textarea rows={3} value={acceptanceForm.limitations} onChange={(event) => setAcceptanceForm((form) => ({ ...form, limitations: event.target.value }))} placeholder="Required for conditional acceptance; include owner and next action." /></label>
                </div>
                {!uatSummary.readyForSignOff && <p className="acceptance-note">Final approval unlocks only after all {uatSummary.total} UAT checks pass. Conditional or rejected decisions remain available for an honest interim record.</p>}
                <Button onClick={() => void saveAcceptance()} disabled={acceptanceSaving}>{acceptanceSaving ? "Saving…" : "Save acceptance record"}</Button>
              </section>
            )}
            <div className="uat-list">
              {uatChecks.map((check) => (
                <section key={check.id} className={`uat-check ${check.status.toLowerCase()}`}>
                  <div className="uat-check-head">
                    <span>{check.status === "PASS" ? <CheckCircle2 /> : check.status === "FAIL" ? <XCircle /> : <ClipboardCheck />}</span>
                    <div>
                      <small>{check.area} · {check.id}</small><h3>{check.title}</h3>
                      <span className="uat-tester">Tester: {check.tester}</span>
                      <ol>{check.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                      <p><b>Expected:</b> {check.expected}</p>
                    </div>
                  </div>
                  <div className="uat-controls">
                    <select value={check.status} onChange={(event) => setUatChecks((items) => items.map((item) => item.id === check.id ? { ...item, status: event.target.value as UatCheck["status"] } : item))}>
                      <option value="NOT_TESTED">Not tested</option><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="BLOCKED">Blocked</option>
                    </select>
                    <Input placeholder="Evidence or issue notes" value={check.notes} onChange={(event) => setUatChecks((items) => items.map((item) => item.id === check.id ? { ...item, notes: event.target.value } : item))} />
                    <Button size="sm" onClick={() => void saveUat(check)} disabled={uatSaving === check.id}>{uatSaving === check.id ? "Saving…" : "Save result"}</Button>
                  </div>
                  {check.testedBy && <footer>Last tested by {check.testedBy}{check.testedAt ? ` · ${formatDateTime(check.testedAt)}` : ""}</footer>}
                </section>
              ))}
              {!uatLoading && !uatChecks.length && <div className="empty-state"><ClipboardCheck /><h3>Open this tab to load UAT checks</h3></div>}
            </div>
          </article>
        </TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{edit ? "Manage user" : "Create user"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save}>
            <div className="dialog-fields grid-2">
              <label>
                Name
                <Input name="name" required defaultValue={edit?.name} />
              </label>
              <label>
                Email
                <Input
                  type="email"
                  name="email"
                  required
                  defaultValue={edit?.email}
                />
              </label>
              <label>
                Mobile
                <Input name="mobile" defaultValue={edit?.mobile} />
              </label>
              <label>
                Role
                <select name="role" defaultValue={edit?.role ?? "RESIDENT"}>
                  {["ADMIN", "DOCTOR", "RESIDENT", "NURSE", "STAFF"].map(
                    (x) => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue={edit?.status ?? "PENDING"}>
                  <option>PENDING</option>
                  <option>ACTIVE</option>
                  <option>INACTIVE</option>
                </select>
              </label>
              <fieldset className="permission-grid permission-matrix">
                <legend>Module-level action permissions</legend>
                <div className="permission-row permission-head">
                  <strong>Module</strong>
                  {actions.map((action) => (
                    <span key={action}>{action}</span>
                  ))}
                </div>
                {modules.map((module) => (
                  <div className="permission-row" key={module}>
                    <strong>{module.replaceAll("_", " ")}</strong>
                    {actions.map((action) => (
                      <label key={action} title={`${module} ${action}`}>
                        <input
                          type="checkbox"
                          name={`${module}:${action}`}
                          aria-label={`${module} ${action}`}
                          defaultChecked={
                            edit?.permissions.includes(module) ||
                            edit?.permissions.includes(`${module}:${action}`)
                          }
                        />
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button>Save access</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current DOPS data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace current database records with the selected recovery package and restore its uploaded files. Download a fresh backup first if the current data must be retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={restoring} onClick={(event) => { event.preventDefault(); void restoreBackup(); }}>
              {restoring ? "Restoring…" : "Restore verified package"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
