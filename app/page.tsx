"use client";
import Image from "next/image";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatDate, localDate } from "@/lib/dates";
import {
  Activity,
  Ambulance,
  BedDouble,
  Bell,
  BookOpen,
  CalendarDays,
  CircleAlert,
  ChevronRight,
  FileText,
  FlaskConical,
  HeartPulse,
  HelpCircle,
  History,
  LayoutDashboard,
  Microscope,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  Theater,
  Trash2,
  UserRoundPlus,
  Wifi,
  WifiOff,
  RefreshCw,
  LogOut,
  Siren,
} from "lucide-react";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ClinicalPhase3 } from "@/components/clinical-phase3";
import { AcademicModule } from "@/components/academic-module";
import { SpecialModule } from "@/components/special-module";
import { AdminModule } from "@/components/admin-module";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listOfflineOpd,
  markOfflineOpdError,
  queueOfflineOpd,
  removeOfflineOpd,
  type OfflineOpdDraft,
} from "@/lib/offline-opd";

type Patient = {
  id: number;
  patientCode: string;
  name: string;
  age: number;
  sex: string;
  mobile: string;
  address: string;
  opdNumber: string | null;
  opdId: number;
  diagnosis: string;
  visitDate: string;
  status: "OPD" | "ADMITTED";
  visitType?: "OPD" | "EMERGENCY";
};
type TimelineEvent = {
  id: string;
  date: string;
  module: string;
  title: string;
  detail: string;
  status?: string;
};
type ClinicalAlert = {
  id: string;
  type: "PAC_PENDING" | "OT_TODAY" | "OT_TOMORROW";
  title: string;
  detail: string;
  module: "Ward" | "OT";
  priority: "urgent" | "normal";
};
type UserAccess = {
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: string[];
  authMethod: "PASSWORDLESS_IDENTITY";
};
const modules = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "OPD", icon: Stethoscope },
  { label: "Emergency OPD", icon: Siren },
  { label: "IPD", icon: Ambulance },
  { label: "Ward", icon: BedDouble },
  { label: "OT", icon: Theater },
  { label: "Class", icon: BookOpen },
  { label: "Skin Bank", icon: HeartPulse },
  { label: "Research", icon: FlaskConical },
  { label: "Publication", icon: FileText },
  { label: "Leprosy", icon: Microscope },
  { label: "CM Helpline", icon: HelpCircle },
  { label: "Admin", icon: ShieldCheck },
];
const moduleKeys: Record<string, string> = {
  OPD: "OPD",
  "Emergency OPD": "OPD", // same data and permissions as OPD
  IPD: "IPD",
  Ward: "WARD",
  OT: "OT",
  Class: "CLASS",
  "Skin Bank": "SKIN_BANK",
  Research: "RESEARCH",
  Publication: "PUBLICATION",
  Leprosy: "LEPROSY",
  "CM Helpline": "CM_HELPLINE",
};

export default function Home() {
  const [active, setActive] = useState("Dashboard"),
    [query, setQuery] = useState(""),
    [records, setRecords] = useState<Patient[]>([]),
    [loading, setLoading] = useState(true),
    [access, setAccess] = useState<UserAccess | null>(null),
    [alerts, setAlerts] = useState<ClinicalAlert[]>([]),
    [online, setOnline] = useState(true),
    [offlineDrafts, setOfflineDrafts] = useState<OfflineOpdDraft[]>([]),
    [syncing, setSyncing] = useState(false);
  const [formOpen, setFormOpen] = useState(false),
    [editing, setEditing] = useState<Patient | null>(null),
    [deleting, setDeleting] = useState<Patient | null>(null),
    [timelinePatient, setTimelinePatient] = useState<Patient | null>(null),
    [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]),
    [timelineLoading, setTimelineLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      // OPD and Emergency OPD visits; each page shows its own.
      const r = await fetch("/api/patients?type=ALL", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setRecords(j.data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load patients.");
    } finally {
      setLoading(false);
    }
  };
  const refreshOfflineDrafts = async () => {
    try {
      const drafts = await listOfflineOpd();
      setOfflineDrafts(drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    } catch {
      // IndexedDB may be unavailable in private browsing modes.
    }
  };
  async function syncOfflineDrafts() {
    if (typeof navigator === "undefined" || !navigator.onLine || syncing) return;
    setSyncing(true);
    let synced = 0;
    try {
      const drafts = await listOfflineOpd();
      for (const draft of drafts) {
        try {
          const r = await fetch("/api/patients", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(draft.body),
          });
          const j = await r.json();
          if (!r.ok) {
            await markOfflineOpdError(draft, j.message || "Could not sync this registration.");
            continue;
          }
          await removeOfflineOpd(draft.id);
          synced += 1;
        } catch {
          break;
        }
      }
      await refreshOfflineDrafts();
      if (synced) {
        await load();
        notify(`${synced} offline OPD registration${synced === 1 ? "" : "s"} synced.`);
      }
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      void fetch("/api/access", { cache: "no-store" })
        .then(async (r) => {
          if (r.status === 401) { window.location.replace("/api/auth/logout?reason=expired"); return null; }
          return r.json();
        })
        .then((j) => j?.success && setAccess(j.data))
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // run once on mount
  useEffect(() => {
    const updateOnline = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline) void syncOfflineDrafts();
    };
    const timer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      void refreshOfflineDrafts().then(() => {
        if (navigator.onLine) void syncOfflineDrafts();
      });
    }, 0);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.clearTimeout(timer);
    };
    // Connection listeners are registered once for the app session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const loadAlerts = () =>
      void fetch("/api/alerts", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => j.success && setAlerts(j.data.alerts))
        .catch(() => {});
    loadAlerts();
    const timer = window.setInterval(loadAlerts, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const visibleModules = modules.filter((item) => {
    if (item.label === "Dashboard" || !access) return true;
    if (item.label === "Admin") return access.role === "ADMIN";
    if (access.role === "ADMIN") return true;
    const key = moduleKeys[item.label];
    return access.permissions.some(
      (permission) => permission === key || permission.startsWith(`${key}:`),
    );
  });
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Record<string, unknown>,
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: "search_opd_patients",
          title: "Search OPD patients",
          description:
            "Search active DOPS OPD records by patient name, Patient ID, diagnosis, or mobile number.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: unknown) => {
            const q = String(
              (input as { query?: unknown })?.query ?? "",
            ).trim();
            const r = await fetch(`/api/patients?q=${encodeURIComponent(q)}`, {
              cache: "no-store",
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.message);
            setActive("OPD");
            setQuery(q);
            return { count: j.data.length, patients: j.data.slice(0, 20) };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    void Promise.resolve(
      context.registerTool(
        {
          name: "register_opd_patient",
          title: "Register OPD patient",
          description:
            "Create a permanent DOPS patient and OPD visit after validating all required details.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer", minimum: 0, maximum: 120 },
              sex: { type: "string", enum: ["Male", "Female", "Other"] },
              mobile: { type: "string", pattern: "^[0-9]{10}$" },
              address: { type: "string" },
              diagnosis: { type: "string" },
            },
            required: ["name", "age", "sex", "mobile", "address", "diagnosis"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: unknown) => {
            const r = await fetch("/api/patients", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.message);
            await load();
            setActive("OPD");
            return { patientCode: j.data.patientCode, status: "registered" };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return q
      ? records.filter((p) =>
          `${p.name} ${p.patientCode} ${p.opdNumber ?? ""} ${p.diagnosis} ${p.mobile} ${p.address} ${p.visitDate} ${formatDate(p.visitDate)}`
            .toLowerCase()
            .includes(q),
        )
      : records;
  }, [records, query]);
  const isEmergency = (p: Patient) => p.visitType === "EMERGENCY";
  const opdRecords = useMemo(() => records.filter((p) => !isEmergency(p)), [records]);
  const notify = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(""), 3500);
  };

  async function savePatient(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries()) as Record<string, string>;
    if (!editing && !navigator.onLine) {
      try {
        await queueOfflineOpd(body);
        await refreshOfflineDrafts();
        setFormOpen(false);
        notify("Saved on this device. It will sync automatically when online.");
      } catch {
        notify("Offline storage is unavailable on this device.");
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      if (!editing) body.visitType = active === "Emergency OPD" ? "EMERGENCY" : "OPD";
      const url = editing ? `/api/patients/${editing.id}` : "/api/patients";
      const r = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setFormOpen(false);
      setEditing(null);
      await load();
      notify(
        editing
          ? "Patient record updated."
          : `Patient registered: ${j.data.patientCode}`,
      );
    } catch (e) {
      if (!editing && (!navigator.onLine || e instanceof TypeError)) {
        try {
          await queueOfflineOpd(body);
          await refreshOfflineDrafts();
          setFormOpen(false);
          notify("Network unavailable. Registration saved for automatic sync.");
        } catch {
          notify("Save failed and offline storage is unavailable.");
        }
      } else {
        notify(e instanceof Error ? e.message : "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }
  async function removePatient() {
    if (!deleting) return;
    try {
      const r = await fetch(`/api/patients/${deleting.id}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setDeleting(null);
      await load();
      notify("Patient removed from active OPD records.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed.");
    }
  }
  async function admit(p: Patient) {
    try {
      const r = await fetch(`/api/opd/${p.opdId}/admit`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      await load();
      notify(`${p.name} admitted to IPD.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Admission failed.");
    }
  }

  async function showTimeline(p: Patient) {
    setTimelinePatient(p);
    setTimelineEvents([]);
    setTimelineLoading(true);
    try {
      const r = await fetch(`/api/patients/${p.id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setTimelineEvents(j.data.events);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not load patient timeline.");
    } finally {
      setTimelineLoading(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas" className="border-r-0">
        <SidebarHeader className="brand-block">
          <Image
            src="/brand/dops-logo-full.png"
            alt="DOPS"
            width={529}
            height={600}
            priority
            unoptimized
            className="brand-logo"
          />
          <span>PLASTIC AND RECONSTRUCTIVE SURGERY</span>
        </SidebarHeader>
        <SidebarContent className="px-3">
          <NavGroup
            title="CLINICAL WORKSPACE"
            items={visibleModules.filter((item) => modules.slice(0, 6).includes(item))}
            active={active}
            setActive={setActive}
          />
          <NavGroup
            title="ACADEMIC WORKSPACE"
            items={visibleModules.filter((item) => modules.slice(6).includes(item))}
            active={active}
            setActive={setActive}
          />
        </SidebarContent>
        <SidebarFooter className="p-4">
          <div className="user-card">
            <div className="avatar">{access?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "DU"}</div>
            <div>
              <strong>{access?.name || "DOPS User"}</strong>
              <span>{access?.role ? access.role.replaceAll("_", " ") : "Verifying access"}</span>
            </div>
            <a className="signout-link" href="/api/auth/logout" aria-label="Sign out"><LogOut /></a>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div className="topbar-title">
            <SidebarTrigger className="md:hidden" />
            <div>
              <strong>PLASTIC AND RECONSTRUCTIVE SURGERY</strong>
              <span>NSCB MEDICAL COLLEGE, JABALPUR</span>
            </div>
          </div>
          <div className="topbar-actions">
            <OfflineSyncCentre
              online={online}
              drafts={offlineDrafts}
              syncing={syncing}
              syncNow={() => void syncOfflineDrafts()}
              removeDraft={async (id) => {
                await removeOfflineOpd(id);
                await refreshOfflineDrafts();
              }}
            />
            <AlertCentre
              alerts={alerts}
              openModule={(module) => setActive(module)}
            />
            <Button variant="outline" size="icon">
              <CalendarDays />
            </Button>
            <Button variant="outline" size="icon">
              <ShieldCheck />
            </Button>
            <div className="date">
              <span>
                {new Date().toLocaleDateString("en-IN", { weekday: "long" })}
              </span>
              <strong>
                {new Date().toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </strong>
            </div>
          </div>
        </header>
        <main className="workspace">
          {active === "Dashboard" ? (
            <Dashboard
              records={opdRecords}
              loading={loading}
              openForm={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              goOpd={() => setActive("OPD")}
              showTimeline={showTimeline}
              userName={access?.name}
            />
          ) : active === "OPD" ? (
            <>
              <ReportBar module="opd" />
              <OpdPage
                records={filtered.filter((p) => !isEmergency(p))}
                query={query}
                setQuery={setQuery}
                loading={loading}
                openForm={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                edit={(p) => {
                  setEditing(p);
                  setFormOpen(true);
                }}
                remove={setDeleting}
                admit={admit}
                showTimeline={showTimeline}
              />
            </>
          ) : active === "Emergency OPD" ? (
            <>
              <ReportBar module="emergency" />
              <OpdPage
                records={filtered.filter(isEmergency)}
                title="Emergency OPD"
                query={query}
                setQuery={setQuery}
                loading={loading}
                openForm={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                edit={(p) => {
                  setEditing(p);
                  setFormOpen(true);
                }}
                remove={setDeleting}
                admit={admit}
                showTimeline={showTimeline}
              />
            </>
          ) : ["IPD", "Ward", "OT"].includes(active) ? (
            <>
              <ReportBar module={active.toLowerCase()} />
              <ClinicalPhase3
                module={active}
                notify={notify}
                onChanged={load}
              />
            </>
          ) : ["Class", "Research", "Publication"].includes(active) ? (
            <AcademicModule module={active} notify={notify} />
          ) : ["Skin Bank", "Leprosy", "CM Helpline"].includes(active) ? (
            <SpecialModule key={active} module={active} notify={notify} />
          ) : active === "Admin" ? (
            <AdminModule notify={notify} />
          ) : (
            <ComingSoon module={active} />
          )}
        </main>
        <PatientDialog
          open={formOpen}
          setOpen={(o) => {
            setFormOpen(o);
            if (!o) setEditing(null);
          }}
          patient={editing}
          saving={saving}
          onSubmit={savePatient}
          kind={(editing ? editing.visitType === "EMERGENCY" : active === "Emergency OPD") ? "Emergency OPD" : "OPD"}
        />
        <TimelineDialog
          patient={timelinePatient}
          events={timelineEvents}
          loading={timelineLoading}
          close={() => setTimelinePatient(null)}
        />
        <AlertDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove OPD record?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting?.name} will disappear from active lists. The medical
                audit history will be retained.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={removePatient}
                className="bg-destructive text-white"
              >
                Remove record
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function OfflineSyncCentre({
  online,
  drafts,
  syncing,
  syncNow,
  removeDraft,
}: {
  online: boolean;
  drafts: OfflineOpdDraft[];
  syncing: boolean;
  syncNow: () => void;
  removeDraft: (id: string) => Promise<void>;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`sync-trigger ${online ? "online" : "offline"}`} aria-label="Offline OPD sync status">
          {online ? <Wifi /> : <WifiOff />}
          <span>{drafts.length ? `${drafts.length} pending` : online ? "Online" : "Offline"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="offline-sync">
        <div className="sync-head">
          <div><strong>Offline OPD queue</strong><span>{online ? "Connected" : "Waiting for internet"}</span></div>
          <span className={online ? "is-online" : "is-offline"}>{online ? <Wifi /> : <WifiOff />}</span>
        </div>
        <p>Pending registrations stay only on this device until they sync.</p>
        <div className="sync-list">
          {drafts.length ? drafts.map((draft) => (
            <div className="sync-item" key={draft.id}>
              <div>
                <strong>{draft.body.name || "Unnamed patient"}</strong>
                <span>{draft.body.diagnosis || "Diagnosis not entered"}</span>
                <small>{new Date(draft.createdAt).toLocaleString("en-IN")}</small>
                {draft.error && <em>{draft.error}</em>}
              </div>
              <Button variant="ghost" size="icon" aria-label={`Delete offline draft for ${draft.body.name}`} onClick={() => {
                if (window.confirm("Delete this unsynced registration from this device?")) void removeDraft(draft.id);
              }}><Trash2 /></Button>
            </div>
          )) : (
            <div className="sync-empty"><ShieldCheck /><strong>Everything is synced</strong><span>No OPD registrations are waiting.</span></div>
          )}
        </div>
        {!!drafts.length && (
          <Button className="sync-now" disabled={!online || syncing} onClick={syncNow}>
            <RefreshCw className={syncing ? "spin" : ""} />{syncing ? "Syncing…" : "Sync now"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AlertCentre({
  alerts,
  openModule,
}: {
  alerts: ClinicalAlert[];
  openModule: (module: "Ward" | "OT") => void;
}) {
  const urgent = alerts.filter((item) => item.priority === "urgent").length;
  const [browserAlerts, setBrowserAlerts] = useState(false);
  useEffect(() => {
    if (!("Notification" in window)) return;
    const timer = window.setTimeout(
      () => setBrowserAlerts(Notification.permission === "granted"),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!browserAlerts || !("Notification" in window)) return;
    const unseen = alerts.filter(
      (item) =>
        item.priority === "urgent" &&
        !localStorage.getItem(`dops-alert-${item.id}`),
    );
    for (const alert of unseen) {
      new Notification(alert.title, { body: alert.detail, icon: "/brand/icon-192.png" });
      localStorage.setItem(`dops-alert-${alert.id}`, "shown");
    }
  }, [alerts, browserAlerts]);
  async function enableBrowserAlerts() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setBrowserAlerts(permission === "granted");
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="alert-trigger"
          aria-label={`${alerts.length} clinical alerts`}
        >
          <Bell />
          {!!alerts.length && (
            <span className={urgent ? "urgent" : ""}>
              {alerts.length > 9 ? "9+" : alerts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="clinical-alerts">
        <div className="alert-head">
          <div>
            <strong>Clinical alerts</strong>
            <span>Updated automatically</span>
          </div>
          {!!urgent && <b>{urgent} urgent</b>}
        </div>
        <div className="alert-list">
          {alerts.length ? (
            alerts.map((alert) => (
              <button
                type="button"
                key={alert.id}
                className={alert.priority}
                onClick={() => openModule(alert.module)}
              >
                <span className="alert-icon">
                  {alert.priority === "urgent" ? <CircleAlert /> : <Bell />}
                </span>
                <span>
                  <strong>{alert.title}</strong>
                  <small>{alert.detail}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="alert-empty">
              <ShieldCheck />
              <strong>No pending clinical alerts</strong>
              <span>PAC and OT schedules are clear.</span>
            </div>
          )}
        </div>
        {!browserAlerts &&
          typeof window !== "undefined" &&
          "Notification" in window && (
          <button
            type="button"
            className="enable-alerts"
            onClick={enableBrowserAlerts}
          >
            <Bell /> Enable browser alerts
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NavGroup({
  title,
  items,
  active,
  setActive,
}: {
  title: string;
  items: typeof modules;
  active: string;
  setActive: (s: string) => void;
}) {
  return (
    <SidebarGroup className="nav-box">
      {/* A boxed group with a count, so it is clear which items belong to it */}
      <SidebarGroupLabel className="nav-box-label">
        <span>{title}</span>
        <span className="nav-box-count" aria-label={`${items.length} sections`}>{items.length}</span>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ label, icon: Icon }) => (
            <SidebarMenuItem key={label}>
              <SidebarMenuButton
                isActive={active === label}
                onClick={() => setActive(label)}
              >
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * "Good morning, Dr Mehta" by the device's local time. Until the signed-in
 * user is known (including the server render) it says "Welcome", so the
 * server and browser render the same text.
 */
function greetingFor(userName?: string) {
  if (!userName) return "Welcome";
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  // The first administrator's name starts as their email address.
  const name = userName.includes("@") ? userName.split("@")[0] : userName;
  return <>{part}, <span className="greet-name">{name}</span></>;
}

function Dashboard({
  records,
  loading,
  openForm,
  goOpd,
  showTimeline,
  userName,
}: {
  records: Patient[];
  loading: boolean;
  openForm: () => void;
  goOpd: () => void;
  showTimeline: (patient: Patient) => void;
  userName?: string;
}) {
  const today = localDate();
  const [clinicalCounts, setClinicalCounts] = useState({
    ipd: 0,
    ward: 0,
    ot: 0,
    discharged: 0,
  });
  const [dashboardQuery, setDashboardQuery] = useState("");
  useEffect(() => {
    void fetch("/api/clinical", { cache: "no-store" })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              data: {
                ipd: Array<{ status: string; admissionDate: string }>;
                ward: Array<{ dischargedAt: string | null }>;
                ot: Array<{ scheduledDate: string }>;
              };
            }>)
          : null,
      )
      .then((j) => {
        if (!j?.data) return;
        setClinicalCounts({
          // Admitted to IPD today, and left the ward today (any STATUS)
          ipd: j.data.ipd.filter((x) => x.admissionDate === today).length,
          discharged: j.data.ward.filter((x) => x.dischargedAt && localDate(0, new Date(x.dischargedAt)) === today).length,
          ward: j.data.ward.filter((x) => !x.dischargedAt).length,
          ot: j.data.ot.filter((x) => x.scheduledDate === today).length,
        });
      })
      .catch(() => {});
  }, [today]);
  const todayCount = records.filter((p) => p.visitDate === today).length;
  const dashboardRecords = dashboardQuery.trim()
    ? records.filter((p) =>
        `${p.name} ${p.patientCode} ${p.diagnosis} ${p.mobile}`
          .toLowerCase()
          .includes(dashboardQuery.toLowerCase().trim()),
      )
    : records.slice(0, 5);
  const cards = [
    {
      label: "Today's OPD",
      value: todayCount,
      note: "Registered today",
      icon: Stethoscope,
      color: "cyan",
    },
    {
      label: "Today's IPD",
      value: clinicalCounts.ipd,
      note: "Admitted today",
      icon: Ambulance,
      color: "amber",
    },
    {
      label: "Patients in Ward",
      value: clinicalCounts.ward,
      note: "Currently admitted",
      icon: BedDouble,
      color: "blue",
    },
    {
      label: "OT Today",
      value: clinicalCounts.ot,
      note: "Scheduled today",
      icon: Theater,
      color: "violet",
    },
    {
      label: "Today Discharged",
      value: clinicalCounts.discharged,
      note: "Left the ward today",
      icon: LogOut,
      color: "rose",
    },
  ];
  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow dash-overview">DEPARTMENT OVERVIEW</p>
          <h1 className="greeting">{greetingFor(userName)}</h1>
          <p>Clinical records are now connected to the permanent database.</p>
        </div>
        <Button className="new-patient" onClick={openForm}>
          <Plus /> Register OPD Patient
        </Button>
      </section>
      <section className="search-wrap dashboard-search">
        <Search />
        <Input
          value={dashboardQuery}
          onChange={(e) => setDashboardQuery(e.target.value)}
          placeholder="Find patient by name, Patient ID, diagnosis or mobile…"
        />
      </section>
      <section className="stats-grid">
        {cards.map(({ label, value, note, icon: Icon, color }) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon ${color}`}>
              <Icon />
            </div>
            <div>
              <span>{label}</span>
              <strong>{loading ? "—" : value}</strong>
              <small>{note}</small>
            </div>
          </article>
        ))}
      </section>
      <section className="content-grid content-grid-full">
        <article className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Recent OPD activity</h2>
              <p>Permanent patient records with one DOPS Patient ID</p>
            </div>
            <Button variant="ghost" onClick={goOpd}>
              View all <ChevronRight />
            </Button>
          </div>
          {loading ? (
            <div className="empty-state">Loading patient records…</div>
          ) : dashboardRecords.length ? (
            <div className="patient-list">
              {dashboardRecords.slice(0, 8).map((p) => (
                <div className="patient-row" key={p.opdId}>
                  <div className="avatar muted">{initials(p.name)}</div>
                  <div className="patient-main">
                    <strong>{p.name}</strong>
                    <span>
                      {p.patientCode} · {p.age}/{p.sex[0]}
                    </span>
                  </div>
                  <div className="diagnosis">
                    <span>Diagnosis</span>
                    <strong>{p.diagnosis}</strong>
                  </div>
                  <span
                    className={`stage ${p.status === "ADMITTED" ? "amber" : "cyan"}`}
                  >
                    {p.status}
                  </span>
                  <time>{formatDate(p.visitDate)}</time>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`View ${p.name} timeline`}
                    onClick={() => showTimeline(p)}
                  >
                    <History />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <UserRoundPlus />
              <h3>No OPD patients yet</h3>
              <p>Register the first patient to begin the clinical workflow.</p>
              <Button onClick={openForm}>
                <Plus /> Register patient
              </Button>
            </div>
          )}
        </article>
      </section>
    </>
  );
}

function OpdPage({
  title = "OPD Patients",
  records,
  query,
  setQuery,
  loading,
  openForm,
  edit,
  remove,
  admit,
  showTimeline,
}: {
  title?: string;
  records: Patient[];
  query: string;
  setQuery: (s: string) => void;
  loading: boolean;
  openForm: () => void;
  edit: (p: Patient) => void;
  remove: (p: Patient) => void;
  admit: (p: Patient) => void;
  showTimeline: (p: Patient) => void;
}) {
  return (
    <>
      <section className="welcome-row">
        <div>
          <h1 className="section-title">{title}</h1>
          <p>
            Register, search and admit patients without duplicate data entry.
          </p>
        </div>
        <Button className="new-patient" onClick={openForm}>
          <Plus /> {title === "Emergency OPD" ? "Register Emergency Patient" : "Register OPD Patient"}
        </Button>
      </section>
      <section className="search-wrap">
        <Search />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, Patient ID, diagnosis, mobile or visit date…"
        />
      </section>
      <article className="panel opd-panel">
        <div className="opd-summary">
          <span>
            <strong>{records.length}</strong> active records
          </span>
          <span>Patient IDs generated automatically</span>
        </div>
        <div className="table-scroll">
          <table className="opd-table opd-patients-table">
            <thead>
              <tr>
                <th className="col-patient">Patient Name</th>
                <th className="col-opdno">OPD No./UHID No.</th>
                <th className="col-agesex">Age/Sex</th>
                <th className="col-diagnosis">Diagnosis</th>
                <th>Mobile</th>
                <th className="col-address">Address</th>
                <th>Visit date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((p) => (
                <tr key={p.opdId}>
                  <td>
                    <strong>{p.name}</strong>
                    <small>{p.patientCode}</small>
                  </td>
                  <td>{p.opdNumber || <span className="muted-dash">—</span>}</td>
                  <td>
                    {p.age} / {p.sex[0]}
                  </td>
                  <td className="col-diagnosis">{p.diagnosis}</td>
                  <td>{p.mobile}</td>
                  <td className="col-address">{p.address}</td>
                  <td>{formatDate(p.visitDate)}</td>
                  <td>
                    <span
                      className={`stage ${p.status === "ADMITTED" ? "amber" : "cyan"}`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => showTimeline(p)}
                      >
                        <History /> Timeline
                      </Button>
                      <Button
                        size="sm"
                        disabled={p.status === "ADMITTED"}
                        onClick={() => admit(p)}
                      >
                        <Ambulance />{" "}
                        {p.status === "ADMITTED" ? "Admitted" : "Admit"}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Edit ${p.name}`}
                        onClick={() => edit(p)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => remove(p)}
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
        {!loading && !records.length && (
          <div className="empty-state">
            <Search />
            <h3>No matching OPD record</h3>
            <p>Try another search or register a new patient.</p>
          </div>
        )}
        {loading && <div className="empty-state">Loading patient records…</div>}
      </article>
    </>
  );
}

function PatientDialog({
  kind = "OPD",
  open,
  setOpen,
  patient,
  saving,
  onSubmit,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  patient: Patient | null;
  kind?: string;
  saving: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>
            {patient ? `Edit ${kind} patient` : `Register ${kind} patient`}
          </DialogTitle>
          <DialogDescription>
            {patient
              ? `Update ${patient.patientCode}. Changes are audit logged.`
              : "A unique DOPS Patient ID will be generated automatically."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label>
              Patient name
              <Input name="name" required defaultValue={patient?.name} />
            </label>
            <label>
              Age
              <Input
                name="age"
                required
                type="number"
                min="0"
                max="120"
                defaultValue={patient?.age}
              />
            </label>
            <label>
              Sex
              <select name="sex" required defaultValue={patient?.sex ?? ""}>
                <option value="" disabled>
                  Select
                </option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Mobile number
              <Input
                name="mobile"
                required
                inputMode="numeric"
                pattern="[0-9]{10}"
                defaultValue={patient?.mobile}
              />
            </label>
            <label>
              OPD No. / UHID No.
              <Input
                name="opdNumber"
                required
                maxLength={40}
                defaultValue={patient?.opdNumber ?? ""}
                placeholder="e.g. OPD/2026/1234"
              />
            </label>
            <label className="span-2">
              Diagnosis
              <Input
                name="diagnosis"
                required
                defaultValue={patient?.diagnosis}
              />
            </label>
            <label className="span-2">
              Address
              <textarea
                name="address"
                required
                defaultValue={patient?.address}
              />
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
            <Button disabled={saving} type="submit">
              {saving
                ? "Saving…"
                : patient
                  ? "Save changes"
                  : "Register patient"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimelineDialog({
  patient,
  events,
  loading,
  close,
}: {
  patient: Patient | null;
  events: TimelineEvent[];
  loading: boolean;
  close: () => void;
}) {
  return (
    <Dialog open={!!patient} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Patient clinical timeline</DialogTitle>
          <DialogDescription>
            {patient
              ? `${patient.name} · ${patient.patientCode} · ${patient.age}/${patient.sex[0]}`
              : "Complete clinical journey"}
          </DialogDescription>
        </DialogHeader>
        {patient && (
          <div className="timeline-summary">
            <div>
              <span>Diagnosis</span>
              <strong>{patient.diagnosis}</strong>
            </div>
            <div>
              <span>Mobile</span>
              <strong>{patient.mobile}</strong>
            </div>
            <div>
              <span>Address</span>
              <strong>{patient.address}</strong>
            </div>
          </div>
        )}
        <div className="patient-timeline">
          {loading ? (
            <div className="timeline-empty">Loading complete history…</div>
          ) : events.length ? (
            events.map((event) => (
              <article key={event.id} className="timeline-event">
                <div className="timeline-dot" />
                <div className="timeline-date">
                  <strong>{formatTimelineDate(event.date)}</strong>
                  <span>{formatTimelineTime(event.date)}</span>
                </div>
                <div className="timeline-card">
                  <div>
                    <span className="timeline-module">{event.module}</span>
                    {event.status && (
                      <span className="timeline-status">{event.status}</span>
                    )}
                  </div>
                  <strong>{event.title}</strong>
                  <p>{event.detail || "No additional notes"}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="timeline-empty">No clinical events available.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComingSoon({ module }: { module: string }) {
  return (
    <article className="panel coming-soon">
      <div className="stat-icon cyan">
        <Activity />
      </div>
      <p className="eyebrow">NEXT DEVELOPMENT PHASE</p>
      <h1>{module}</h1>
      <p>
        The navigation is ready. This module will be connected after the
        complete OPD → IPD core workflow.
      </p>
    </article>
  );
}
function initials(name: string) {
  return name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function formatTimelineDate(value: string) {
  return formatDate(value);
}
function formatTimelineTime(value: string) {
  if (!value.includes("T")) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
}
function ReportBar({ module }: { module: string }) {
  const now = new Date(), currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentMonth),
    [archive, setArchive] = useState<{ month: string; count: number }[]>([]);
  useEffect(() => {
    if (!["opd", "ot"].includes(module)) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/reports/months?module=${module}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((result) => result.success && setArchive(result.data));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [module]);
  if (!["opd", "ot"].includes(module)) return null;
  const [year, monthNumber] = month.split("-").map(Number),
    from = `${month}-01`,
    to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
    base = `/api/reports/${module}?from=${from}&to=${to}`;
  const selected = archive.find((item) => item.month === month);
  return (
    <div className="report-bar">
      <span>
        <FileText /> Monthly {module === "emergency" ? "Emergency OPD" : module.toUpperCase()} report archive
      </span>
      <div className="report-controls">
        <label>
          Month
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            {(archive.length ? archive : [{ month: currentMonth, count: 0 }]).map((item) => (
              <option key={item.month} value={item.month}>
                {new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} · {item.count} {module === "opd" ? "patients" : "cases"}
              </option>
            ))}
          </select>
        </label>
        <small>{selected?.count ?? 0} records · automatically prepared from saved data</small>
        <Button asChild variant="outline" size="sm">
          <a href={`${base}&format=csv`}>Download CSV</a>
        </Button>
        <Button asChild size="sm">
          <a href={`${base}&format=pdf`}>Download PDF</a>
        </Button>
      </div>
    </div>
  );
}
