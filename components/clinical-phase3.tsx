"use client";
import { FormEvent, useEffect, useState } from "react";
import { formatDate, istDate } from "@/lib/dates";
import { uploadAllDirect, uploadDirect } from "@/lib/direct-upload";
import Image from "next/image";
import {
  BedDouble,
  CalendarPlus,
  Check,
  ClipboardPen,
  FileUp,
  Images,
  ImagePlus,
  Search,
  Stethoscope,
  Trash2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Ipd = {
  id: number;
  patientId: number;
  patientCode: string;
  opdNumber?: string | null;
  caseCategory?: string | null;
  name: string;
  age: number;
  sex: string;
  mobile: string;
  diagnosis: string;
  admissionDate: string;
  planManagement: string;
  ayushmanCode: string;
  status: string;
};
/** How a patient can leave the ward. */
const WARD_EXIT = ["DISCHARGED", "LAMA", "DOR", "DAMA"];

type Ward = {
  wardId: number;
  ipdId: number;
  patientCode: string;
  name: string;
  age: number;
  sex: string;
  diagnosis: string;
  wardName: string;
  bedNumber: string;
  pacStatus: string;
  admittedAt: string;
  dischargedAt: string | null;
  dischargeStatus?: string | null;
  caseCategory?: string | null;
  opdNumber?: string | null;
};
type Ot = {
  id: number;
  ipdId: number;
  patientCode: string;
  name: string;
  diagnosis: string;
  scheduledDate: string;
  scheduledTime: string;
  procedureName: string;
  surgeonName: string;
  pacStatus: string;
  status: string;
};
type Data = { ipd: Ipd[]; ward: Ward[]; ot: Ot[] };

export function ClinicalPhase3({
  module,
  notify,
  onChanged,
}: {
  module: string;
  notify: (m: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data>({ ipd: [], ward: [], ot: [] }),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [wardTab, setWardTab] = useState<"ADMIT" | "DISCHARGED">("ADMIT"),
    [dialog, setDialog] = useState<"ipd" | "ward" | "ot" | "discharge" | null>(
      null,
    ),
    [selected, setSelected] = useState<Ipd | Ward | null>(null),
    [saving, setSaving] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/clinical", { cache: "no-store" }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setData(j.data);
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Could not load clinical records.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Reload when the visible clinical module changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);
  async function action(body: Record<string, unknown>, done = "Clinical record updated.") {
    setSaving(true);
    try {
      const r = await fetch("/api/clinical", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setDialog(null);
      await load();
      onChanged();
      notify(done);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setSaving(false);
    }
  }
  // CM Helpline cases are raised from the Ward; the server looks up the
  // patient, diagnosis and bed from the ward stay.
  async function addToHelpline(w: Ward) {
    try {
      const r = await fetch("/api/special", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "link_helpline",
            source: "WARD",
            sourceRecordId: w.wardId,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      notify(`${w.name} added to CM Helpline.`);
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Could not add CM Helpline case.",
      );
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (dialog === "discharge") {
      setSaving(true);
      try {
        const wardId = (selected as Ward).wardId,
          card = fd.get("card");
        // Optional discharge card goes straight to storage first.
        const uploadId = card instanceof File && card.size ? await uploadDirect(card, { purpose: "DISCHARGE_CARD", wardId }) : undefined;
        const r = await fetch("/api/clinical", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "discharge", wardId, notes: fd.get("notes") ?? "", status: fd.get("status") ?? "DISCHARGED", uploadId }),
          }),
          j = await r.json();
        if (!r.ok) throw new Error(j.message);
        setDialog(null);
        await load();
        onChanged();
        notify("Patient discharged successfully.");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Discharge failed.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const values = Object.fromEntries(fd.entries());
    const selectedId = selected && "id" in selected ? selected.id : selected?.ipdId;
    await action({ ...values, id: selectedId });
  }
  const open = (type: typeof dialog, row: Ipd | Ward) => {
    setSelected(row);
    setDialog(type);
  };
  const q = query.toLowerCase();
  const ipd = data.ipd.filter((x) =>
    `${x.name} ${x.patientCode} ${x.opdNumber ?? ""} ${x.diagnosis} ${x.admissionDate} ${formatDate(x.admissionDate)}`.toLowerCase().includes(q),
  );
  const matchesWard = (x: Ward) =>
    `${x.name} ${x.patientCode} ${x.opdNumber ?? ""} ${x.diagnosis} ${x.wardName} ${x.bedNumber} ${formatDate(x.admittedAt)} ${x.dischargeStatus ?? ""} ${x.caseCategory ?? ""}`
      .toLowerCase()
      .includes(q);
  // Ward has two lists: patients in the ward, and patients who have left (kept with how they left).
  const inWard = data.ward.filter((x) => !x.dischargedAt && matchesWard(x));
  const leftWard = data.ward.filter((x) => x.dischargedAt && matchesWard(x));
  return (
    <>
      <div className="module-heading">
        <div>
          <h1 className="section-title">{module}</h1>
          <p>
            {module === "IPD"
              ? "Manage treatment plans and transfer admitted patients to Ward."
              : module === "Ward"
                ? "Active ward census, PAC fitness and discharge management."
                : "Plan and track operation theatre procedures."}
          </p>
        </div>
        <div className="module-count">
          {module === "IPD"
            ? ipd.length
            : module === "Ward"
              ? (wardTab === "ADMIT" ? inWard : leftWard).length
              : data.ot.length}
          <span>records</span>
        </div>
      </div>
      <section className="search-wrap">
        <Search />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${module} by patient, ID, diagnosis${module === "OT" ? ", surgeon, procedure or date" : " or date"}…`}
        />
      </section>
      {module === "IPD" && (
        <ClinicalTable
          headers={[
            "Patient Name",
            "OPD No./UHID No.",
            "Diagnosis",
            "Admission",
            "Management / Ayushman",
            "CASE CATEGORY",
            "Status",
            "Actions",
          ]}
          loading={loading}
          empty={!ipd.length}
        >
          {ipd.map((p) => (
            <tr key={p.id}>
              <PatientCell p={p} />
              <td>{p.opdNumber || "—"}</td>
              <td>{p.diagnosis}</td>
              <td className="nowrap">{formatDate(p.admissionDate)}</td>
              <td>
                <strong>{p.planManagement || "Not added"}</strong>
                <small>
                  {p.ayushmanCode
                    ? `Ayushman: ${p.ayushmanCode}`
                    : "No Ayushman code"}
                </small>
              </td>
              <td>
                <select
                  className={`case-select ${(p.caseCategory ?? "").toLowerCase()}`}
                  aria-label={`Case category for ${p.name}`}
                  value={p.caseCategory ?? ""}
                  onChange={(e) => action({ action: "case_category", id: p.id, category: e.target.value })}
                >
                  <option value="">Select</option>
                  <option value="MLC">MLC</option>
                  <option value="NON-MLC">NON-MLC</option>
                </select>
              </td>
              <td>
                {/* A patient is never discharged from IPD itself: that happens in Ward. */}
                <Badge value="ADMITTED" />
              </td>
              <td>
                <div className="row-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open("ipd", p)}
                  >
                    <ClipboardPen /> Plan
                  </Button>
                  <Button
                    size="sm"
                    disabled={p.status !== "ADMITTED"}
                    onClick={() => open("ward", p)}
                  >
                    <BedDouble />{" "}
                    {p.status === "ADMITTED" ? "Move to Ward" : "In Ward"}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </ClinicalTable>
      )}
      {module === "Ward" && (
        <>
          {/* Two lists, like Skin Bank: patients in the ward, and patients who have left */}
          <Tabs value={wardTab} onValueChange={(v) => setWardTab(v as "ADMIT" | "DISCHARGED")}>
            <TabsList>
              <TabsTrigger value="ADMIT" className="ward-tab ward-tab-admit">ADMIT PATIENT ({inWard.length})</TabsTrigger>
              <TabsTrigger value="DISCHARGED" className="ward-tab ward-tab-discharged">DISCHARGED PATIENT ({leftWard.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <ClinicalTable
            headers={[
              "Patient Name",
              "Ward / Bed",
              "Diagnosis",
              "CASE CATEGORY",
              "PAC fitness",
              "Admitted",
              wardTab === "ADMIT" ? "Schedule OT" : "STATUS",
              "Actions",
            ]}
            loading={loading}
            empty={!(wardTab === "ADMIT" ? inWard : leftWard).length}
          >
            {(wardTab === "ADMIT" ? inWard : leftWard).map((w) => (
              <tr key={w.wardId}>
                <PatientCell p={w} />
                <td>
                  <strong>{w.wardName}</strong>
                  <small>Bed {w.bedNumber}</small>
                </td>
                <td>{w.diagnosis}</td>
                <td>{w.caseCategory ? <span className={`case-badge ${w.caseCategory.toLowerCase()}`}>{w.caseCategory}</span> : "—"}</td>
                <td>
                  {w.dischargedAt ? (
                    <Badge value={w.pacStatus} />
                  ) : (
                    <select
                      className={`pac-select ${w.pacStatus.toLowerCase()}`}
                      aria-label={`PAC fitness for ${w.name}`}
                      value={w.pacStatus}
                      onChange={(e) =>
                        action({ action: "pac", id: w.wardId, status: e.target.value }, `PAC updated: ${e.target.value}`)
                      }
                    >
                      <option>PENDING</option>
                      <option>FIT</option>
                      <option>UNFIT</option>
                    </select>
                  )}
                </td>
                <td className="nowrap">{formatDate(w.admittedAt)}</td>
                <td>
                  {w.dischargedAt ? (
                    <>
                      <select
                        className="exit-select"
                        aria-label={`Status for ${w.name}`}
                        value={w.dischargeStatus ?? "DISCHARGED"}
                        onChange={(e) => action({ action: "ward_status", wardId: w.wardId, status: e.target.value })}
                      >
                        {WARD_EXIT.map((x) => <option key={x}>{x}</option>)}
                      </select>
                      <small className="exit-date">{formatDate(w.dischargedAt)}</small>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => open("ot", w)}>
                      <CalendarPlus /> Schedule OT
                    </Button>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    {!w.dischargedAt && (
                      <Button size="sm" onClick={() => open("discharge", w)}>
                        <FileUp /> Discharge
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => addToHelpline(w)}>
                      <Stethoscope /> CM Helpline
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </ClinicalTable>
        </>
      )}
      {module === "OT" && (
        <OtView
          data={data.ot.filter((x) =>
            `${x.name} ${x.patientCode} ${x.diagnosis} ${x.procedureName} ${x.surgeonName} ${x.scheduledDate} ${formatDate(x.scheduledDate)}`
              .toLowerCase()
              .includes(q),
          )}
          loading={loading}
          update={(id, status) => action({ action: "ot_status", id, status })}
          notify={notify}
        />
      )}
      <ActionDialog
        type={dialog}
        row={selected}
        open={!!dialog}
        close={() => setDialog(null)}
        submit={submit}
        saving={saving}
      />
    </>
  );
}

function ClinicalTable({
  headers,
  children,
  loading,
  empty,
}: {
  headers: string[];
  children: React.ReactNode;
  loading: boolean;
  empty: boolean;
}) {
  return (
    <article className="panel opd-panel">
      <div className="table-scroll">
        <table className="opd-table clinical-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {loading && <div className="empty-state">Loading clinical records…</div>}
      {!loading && empty && (
        <div className="empty-state">
          <Stethoscope />
          <h3>No records here yet</h3>
          <p>
            Patients will appear here as they move through the clinical
            workflow.
          </p>
        </div>
      )}
    </article>
  );
}
function PatientCell({
  p,
}: {
  p: { name: string; patientCode: string; age?: number; sex?: string };
}) {
  return (
    <td>
      <strong>{p.name}</strong>
      <small>
        {p.patientCode}
        {p.age !== undefined ? ` · ${p.age}/${p.sex?.[0]}` : ""}
      </small>
    </td>
  );
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`clinical-badge ${value.toLowerCase()}`}>
      {value.replace("_", " ")}
    </span>
  );
}
function OtView({
  data,
  loading,
  update,
  notify,
}: {
  data: Ot[];
  loading: boolean;
  update: (id: number, s: string) => void;
  notify: (message: string) => void;
}) {
  type OtImage = {
    id: number;
    imageType: "PRE_OP" | "POST_OP";
    fileKey: string;
    fileName: string;
    createdAt: string;
  };
  const [imageOt, setImageOt] = useState<Ot | null>(null),
    [images, setImages] = useState<OtImage[]>([]),
    [imageLoading, setImageLoading] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadProgress, setUploadProgress] = useState("");
  async function loadImages(otId: number) {
    setImageLoading(true);
    try {
      const r = await fetch(`/api/ot-images?otId=${otId}`, {
          cache: "no-store",
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setImages(j.data);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not load OT images.");
    } finally {
      setImageLoading(false);
    }
  }
  async function openImages(ot: Ot) {
    setImageOt(ot);
    await loadImages(ot.id);
  }
  async function uploadImages(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!imageOt) return;
    setUploading(true);
    try {
      const formElement = e.currentTarget,
        form = new FormData(formElement),
        imageType = String(form.get("imageType") ?? "PRE_OP"),
        files = form.getAll("images").filter((x): x is File => x instanceof File && x.size > 0);
      if (!files.length || files.length > 6) throw new Error("Select 1 to 6 images.");
      // Each photo goes straight to storage (no size limit from the server);
      // the API then attaches the verified files to this OT record.
      setUploadProgress(`0/${files.length}`);
      const uploadIds = await uploadAllDirect(files, { purpose: "OT_IMAGE", otId: imageOt.id, imageType }, (done, total) => setUploadProgress(`${done}/${total}`));
      const r = await fetch("/api/ot-images", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ otId: imageOt.id, imageType, uploadIds }),
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      formElement.reset();
      await loadImages(imageOt.id);
      notify(`${j.data.uploaded} OT image(s) uploaded.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Image upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }
  async function removeImage(id: number) {
    if (!imageOt || !confirm("Remove this OT image?")) return;
    try {
      const r = await fetch(`/api/ot-images?id=${id}`, { method: "DELETE" }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      await loadImages(imageOt.id);
      notify("OT image removed.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not remove image.");
    }
  }
  const [today] = useState(() => istDate()),
    [tomorrow] = useState(() => istDate(1));
  const lists = {
    today: data.filter((x) => x.scheduledDate === today),
    tomorrow: data.filter((x) => x.scheduledDate === tomorrow),
    previous: data.filter((x) => x.scheduledDate < today),
  };
  return (
    <Tabs defaultValue="today">
      <TabsList>
        <TabsTrigger value="today">Today ({lists.today.length})</TabsTrigger>
        <TabsTrigger value="tomorrow">
          Tomorrow ({lists.tomorrow.length})
        </TabsTrigger>
        <TabsTrigger value="previous">
          Previous ({lists.previous.length})
        </TabsTrigger>
      </TabsList>
      {Object.entries(lists).map(([key, list]) => (
        <TabsContent value={key} key={key}>
          <ClinicalTable
            headers={[
              "Date / Time",
              "Patient Name",
              "Procedure",
              "Surgeon",
              "PAC",
              "Status / Action",
            ]}
            loading={loading}
            empty={!list.length}
          >
            {list.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong className="nowrap">{formatDate(o.scheduledDate)}</strong>
                  <small>{o.scheduledTime}</small>
                </td>
                <PatientCell p={o} />
                <td>
                  <strong>{o.procedureName}</strong>
                  <small>{o.diagnosis}</small>
                </td>
                <td>{o.surgeonName}</td>
                <td>
                  <span className="pac-big"><Badge value={o.pacStatus} /></span>
                </td>
                <td>
                  <div className="row-actions">
                    <Badge value={o.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openImages(o)}
                    >
                      <Images /> Images
                    </Button>
                    {o.status === "SCHEDULED" && (
                      <Button
                        size="icon-sm"
                        aria-label="Mark completed"
                        onClick={() => update(o.id, "COMPLETED")}
                      >
                        <Check />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </ClinicalTable>
        </TabsContent>
      ))}
      <Dialog
        open={!!imageOt}
        onOpenChange={(open) => !open && setImageOt(null)}
      >
        <DialogContent className="sm:max-w-[820px]">
          <DialogHeader>
            <DialogTitle>OT Image Record</DialogTitle>
            <DialogDescription>
              {imageOt?.name} · {imageOt?.patientCode} ·{" "}
              {imageOt?.procedureName}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={uploadImages} className="ot-image-upload">
            <label>
              Image category
              <select name="imageType" required defaultValue="PRE_OP">
                <option value="PRE_OP">Pre-op</option>
                <option value="POST_OP">Post-op</option>
              </select>
            </label>
            <label>
              Select images
              <Input
                name="images"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                required
              />
            </label>
            <Button disabled={uploading}>
              <ImagePlus /> {uploading ? `Uploading${uploadProgress ? ` ${uploadProgress}` : ""}…` : "Upload images"}
            </Button>
            <small>JPG, PNG or WebP · maximum 6 at once · 8 MB each</small>
          </form>
          {imageLoading ? (
            <div className="empty-state">Loading images…</div>
          ) : (
            <div className="ot-image-sections">
              {(["PRE_OP", "POST_OP"] as const).map((type) => (
                <section key={type}>
                  <h3>
                    {type === "PRE_OP" ? "Pre-op" : "Post-op"} (
                    {images.filter((x) => x.imageType === type).length})
                  </h3>
                  <div className="ot-image-grid">
                    {images
                      .filter((x) => x.imageType === type)
                      .map((image) => (
                        <figure key={image.id}>
                          <a
                            href={`/api/files?key=${encodeURIComponent(image.fileKey)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Image
                              src={`/api/files?key=${encodeURIComponent(image.fileKey)}`}
                              alt={`${type === "PRE_OP" ? "Pre-op" : "Post-op"} clinical image`}
                              width={640}
                              height={480}
                              unoptimized
                            />
                          </a>
                          <figcaption>
                            <span title={image.fileName}>{image.fileName}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Remove image"
                              onClick={() => removeImage(image.id)}
                            >
                              <Trash2 />
                            </Button>
                          </figcaption>
                        </figure>
                      ))}
                  </div>
                  {!images.some((x) => x.imageType === type) && (
                    <p className="image-empty">No images uploaded.</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

function ActionDialog({
  type,
  row,
  open,
  close,
  submit,
  saving,
}: {
  type: string | null;
  row: Ipd | Ward | null;
  open: boolean;
  close: () => void;
  submit: (e: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const title =
    type === "ipd"
      ? "Update treatment plan"
      : type === "ward"
        ? "Move patient to Ward"
        : type === "ot"
          ? "Schedule OT procedure"
          : "Discharge patient";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {row?.name} · {row?.patientCode}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          {type === "ipd" && (
            <div className="dialog-fields">
              <input type="hidden" name="action" value="update_ipd" />
              <label>
                Plan / Management
                <textarea
                  name="planManagement"
                  required
                  defaultValue={(row as Ipd)?.planManagement}
                />
              </label>
              <label>
                Ayushman code
                <Input
                  name="ayushmanCode"
                  defaultValue={(row as Ipd)?.ayushmanCode}
                />
              </label>
            </div>
          )}
          {type === "ward" && (
            <div className="dialog-fields grid-2">
              <input type="hidden" name="action" value="move_ward" />
              <label>
                Ward name
                <Input name="wardName" required placeholder="Burn Ward" />
              </label>
              <label>
                Bed number
                <Input name="bedNumber" required placeholder="12" />
              </label>
            </div>
          )}
          {type === "ot" && (
            <div className="dialog-fields grid-2">
              <input type="hidden" name="action" value="schedule_ot" />
              <label>
                Date
                <Input type="date" name="scheduledDate" required />
              </label>
              <label>
                Time
                <Input type="time" name="scheduledTime" required />
              </label>
              <label className="wide">
                Procedure planned
                <Input name="procedureName" required />
              </label>
              <label className="wide">
                Surgeon name
                <Input name="surgeonName" required />
              </label>
            </div>
          )}
          {type === "discharge" && (
            <div className="dialog-fields">
              <input type="hidden" name="action" value="discharge" />
              <label>
                Discharge notes
                <textarea name="notes" required />
              </label>
              <label>
                STATUS
                <select name="status" defaultValue="DISCHARGED" required>
                  {WARD_EXIT.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label>
                Discharge card (PDF, JPG or PNG — max 10 MB)
                <Input type="file" name="card" accept=".pdf,.jpg,.jpeg,.png" />
              </label>
            </div>
          )}
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={saving} type="submit">
              {saving
                ? "Saving…"
                : type === "discharge"
                  ? "Confirm discharge"
                  : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
