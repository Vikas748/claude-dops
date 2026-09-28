"use client";
import { FormEvent, useEffect, useState } from "react";
import { uploadDirect } from "@/lib/direct-upload";
import {
  ExternalLink,
  FileText,
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
type Doc = {
  id: number;
  title: string;
  doctorName: string;
  documentDate: string;
  fileKey: string;
  fileName: string;
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
        file = f.get("file");
      if (!(file instanceof File) || !file.size) throw new Error("Select a PDF to upload.");
      // The PDF goes straight to storage; the API then receives only the details.
      const uploadId = await uploadDirect(file, { purpose: "ACADEMIC", kind });
      const r = await fetch("/api/academic", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            title: f.get("title"),
            doctorName: f.get("doctorName"),
            documentDate: f.get("documentDate"),
            externalUrl: f.get("externalUrl") ?? "",
            uploadId,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setOpen(false);
      await load();
      notify(`${module} document uploaded.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.");
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
          <p className="eyebrow">ACADEMIC WORKSPACE</p>
          <h1>{module}</h1>
          <p>
            {module === "Class"
              ? "Lecture notes and departmental teaching sessions."
              : module === "Research"
                ? "Department research papers and working documents."
                : "Published work, journal PDFs and external links."}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
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
                <span>{d.documentDate}</span>
                <h3>{d.title}</h3>
                <p>{d.doctorName}</p>
                <small>{d.fileName}</small>
              </div>
              <div className="doc-actions">
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/files?key=${encodeURIComponent(d.fileKey)}`}
                    target="_blank"
                  >
                    <FileText /> PDF
                  </a>
                </Button>
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
            <p>Upload the first PDF to create the departmental archive.</p>
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add document
            </Button>
          </div>
        )}
      </article>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {module} document</DialogTitle>
            <DialogDescription>
              PDFs are stored privately and listed by date.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <div className="dialog-fields">
              <label>
                {module === "Class" ? "Topic name" : "Title"}
                <Input name="title" required />
              </label>
              <label>
                Doctor name
                <Input name="doctorName" required />
              </label>
              <label>
                Date
                <Input type="date" name="documentDate" required />
              </label>
              {module === "Publication" && (
                <label>
                  External journal / DOI link
                  <Input
                    type="url"
                    name="externalUrl"
                    placeholder="https://..."
                  />
                </label>
              )}
              <label>
                PDF document
                <Input
                  type="file"
                  name="file"
                  accept="application/pdf,.pdf"
                  required
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
                {saving ? "Uploading…" : "Upload PDF"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
