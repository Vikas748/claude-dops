"use client";
import { FormEvent, useEffect, useState } from "react";
import { formatDate } from "@/lib/dates";
import { uploadDirect } from "@/lib/direct-upload";
import {
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
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
const hasFileMessage = (module: string) => `${module} added.`;

type Doc = {
  id: number;
  title: string;
  doctorName: string;
  documentDate: string;
  fileKey: string | null;
  fileName: string | null;
  externalUrl: string | null;
};
export function AcademicModule({
  module,
  notify,
}: {
  module: string;
  notify: (m: string) => void;
}) {
  const [docs, setDocs] = useState<Doc[]>([]),
    [q, setQ] = useState(""),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Doc | null>(null),
    [saving, setSaving] = useState(false),
    [loading, setLoading] = useState(true);
  const kind = module.toUpperCase();
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(
          `/api/academic?kind=${kind}&q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        ),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setDocs(j.data);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
    // Search and module changes trigger a fresh document query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, q]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const f = new FormData(e.currentTarget),
        file = f.get("file"),
        hasFile = file instanceof File && file.size > 0;
      // The PDF is optional. If chosen, it goes straight to storage first and
      // the API then receives only the details plus the uploadId.
      const uploadId = hasFile ? await uploadDirect(file as File, { purpose: "ACADEMIC", kind }) : undefined;
      const r = await fetch("/api/academic", {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: editing?.id,
            kind,
            title: f.get("title"),
            doctorName: f.get("doctorName"),
            documentDate: f.get("documentDate"),
            externalUrl: f.get("externalUrl") ?? editing?.externalUrl ?? "",
            uploadId,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setOpen(false);
      await load();
      notify(editing ? `${module} updated.` : hasFileMessage(module));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: number) {
    if (!confirm("Remove this document from the active list?")) return;
    const r = await fetch(`/api/academic?id=${id}`, { method: "DELETE" }),
      j = await r.json();
    if (!r.ok) return notify(j.message);
    await load();
    notify("Document removed.");
  }
  return (
    <>
      <section className="welcome-row">
        <div>
          <h1 className="section-title">{module}</h1>
          <p>
            {module === "Class"
              ? "Lecture notes and departmental teaching sessions."
              : module === "Research"
                ? "Department research papers and working documents."
                : "Published work, journal PDFs and external links."}
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus /> Add {module}
        </Button>
      </section>
      <section className="search-wrap">
        <Search />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search by ${module === "Class" ? "topic" : "title"}, doctor or date…`}
        />
      </section>
      <article className="panel academic-grid">
        {loading ? (
          <div className="empty-state">Loading documents…</div>
        ) : docs.length ? (
          docs.map((d) => (
            <div className="document-card" key={d.id}>
              <div className="doc-icon">
                <FileText />
              </div>
              <div className="doc-content">
                <span>{formatDate(d.documentDate)}</span>
                <h3>{d.title}</h3>
                <p>{d.doctorName}</p>
                {d.fileKey ? <small>{d.fileName}</small> : <small className="doc-no-pdf">No PDF yet</small>}
              </div>
              <div className="doc-actions">
                {d.fileKey ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/files?key=${encodeURIComponent(d.fileKey)}`} target="_blank">
                      <FileText /> PDF
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => { setEditing(d); setOpen(true); }}>
                    <Upload /> Add PDF
                  </Button>
                )}
                {d.externalUrl && (
                  <Button asChild variant="outline" size="icon-sm">
                    <a href={d.externalUrl} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${d.title}`}
                  onClick={() => { setEditing(d); setOpen(true); }}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${d.title}`}
                  onClick={() => remove(d.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Upload />
            <h3>No {module.toLowerCase()} documents yet</h3>
            <p>Add the first entry. The PDF can be uploaded now or later.</p>
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus /> Add {module}
            </Button>
          </div>
        )}
      </article>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${module}` : `Add ${module}`}</DialogTitle>
            <DialogDescription>
              {editing ? "Change the details, or upload / replace the PDF." : "The PDF is optional. You can upload it later with Edit."}
            </DialogDescription>
          </DialogHeader>
          <form key={editing?.id ?? "new"} onSubmit={submit}>
            <div className="dialog-fields">
              <label>
                {module === "Class" ? "Topic name" : "Title"}
                <Input name="title" defaultValue={editing?.title ?? ""} required />
              </label>
              <label>
                Doctor name
                <Input name="doctorName" defaultValue={editing?.doctorName ?? ""} required />
              </label>
              <label>
                Date
                <Input type="date" name="documentDate" defaultValue={editing?.documentDate ?? ""} required />
              </label>
              {module === "Publication" && (
                <label>
                  External journal / DOI link
                  <Input
                    type="url"
                    name="externalUrl"
                    defaultValue={editing?.externalUrl ?? ""}
                    placeholder="https://..."
                  />
                </label>
              )}
              <label>
                {editing?.fileKey ? "Replace PDF (optional)" : "PDF document (optional)"}
                <Input type="file" name="file" accept="application/pdf,.pdf" />
                {editing && (
                  <small className="doc-file-hint">{editing.fileKey ? `Current: ${editing.fileName}` : "No PDF uploaded yet."}</small>
                )}
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
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
