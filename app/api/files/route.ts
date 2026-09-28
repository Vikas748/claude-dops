import { getDopsBucket, getDopsDb, jsonError } from "@/lib/dops-db";
import { isResponse, requirePermission } from "@/lib/access";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await serveFile(request);
  } catch (error) {
    console.error("File access failed", error);
    return jsonError("File storage is temporarily unavailable.", 503);
  }
}

async function serveFile(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("Missing file", { status: 400 });
  if (key.includes("..")) return jsonError("Invalid file key.", 400);
  const db = getDopsDb();
  let permissionModule: string | null = null;
  if (key.startsWith("academic/")) {
    const record = await db.prepare("SELECT kind FROM academic_documents WHERE file_key=? AND deleted_at IS NULL").bind(key).first<{ kind: string }>();
    permissionModule = record?.kind ?? null;
  } else if (key.startsWith("patients/")) {
    const record = await db.prepare("SELECT id FROM ot_images WHERE file_key=? AND deleted_at IS NULL").bind(key).first();
    permissionModule = record ? "OT" : null;
  } else if (key.startsWith("discharge/")) {
    const record = await db.prepare("SELECT id FROM discharge_records WHERE card_key=?").bind(key).first();
    permissionModule = record ? "WARD" : null;
  }
  if (!permissionModule) return jsonError("File not found.", 404);
  const access = await requirePermission(permissionModule, "VIEW");
  if (isResponse(access)) return access;
  // Redirect to a short-lived signed URL: the file streams straight from
  // storage to the browser, never through a Vercel function (no 4.5 MB limit).
  const signed = await getDopsBucket().signDownload(key, 120);
  if (!signed) return jsonError("File not found.", 404);
  return new Response(null, {
    status: 302,
    headers: { location: signed, "cache-control": "private, no-store" },
  });
}
