/**
 * Browser helper for direct uploads (see lib/uploads.ts for the server side).
 * Safe to import from "use client" components — no server code here.
 */

type UploadContext =
  | { purpose: "ACADEMIC"; kind: string }
  | { purpose: "OT_IMAGE"; otId: number; imageType: string }
  | { purpose: "DISCHARGE_CARD"; wardId: number };

/** Browsers sometimes leave file.type empty (e.g. some Android pickers); infer from the name. */
export function fileContentType(file: File) {
  if (file.type) return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (/\.jpe?g$/.test(name)) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: Record<string, unknown> };
}

/** PUT a body to a signed storage URL. */
export async function putToSignedUrl(uploadUrl: string, body: Blob | ArrayBuffer, contentType: string) {
  let response: Response;
  try {
    response = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": contentType, "cache-control": "max-age=3600" }, body });
  } catch {
    throw new Error("Upload interrupted. Check your internet connection and try again.");
  }
  if (!response.ok)
    throw new Error(response.status === 413 ? "File is larger than storage allows." : `Upload failed (${response.status}). Try again.`);
}

/** Uploads one file straight to storage. Returns the uploadId to send to the module API. */
export async function uploadDirect(file: File, context: UploadContext) {
  const contentType = fileContentType(file);
  const sign = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...context, fileName: file.name, contentType, size: file.size }),
  });
  const signed = await readJson(sign);
  if (!sign.ok || !signed.data?.uploadUrl) throw new Error(signed.message ?? "Upload could not start.");
  await putToSignedUrl(String(signed.data.uploadUrl), file, contentType);
  return String(signed.data.uploadId);
}

/** Uploads several files, at most 3 at a time. Returns uploadIds in the same order. */
export async function uploadAllDirect(files: File[], context: UploadContext, onProgress?: (done: number, total: number) => void) {
  const ids: string[] = new Array(files.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      ids[index] = await uploadDirect(files[index], context);
      onProgress?.(++done, files.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  return ids;
}
