import postgres, { type Sql } from "postgres";
import { getR2Config, getR2BucketInstance } from "@/lib/r2-storage";

type QueryExecutor = Pick<Sql, "unsafe">;

function connection() {
  const databaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is not configured.");
  const globalDb = globalThis as typeof globalThis & { __dopsPostgres?: Sql };
  if (!globalDb.__dopsPostgres) {
    globalDb.__dopsPostgres = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: "require",
      prepare: false,
    });
  }
  return globalDb.__dopsPostgres;
}

function postgresQuery(input: string) {
  let output = "", parameter = 0, quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      output += character;
      if (character === quote && input[index + 1] === quote) output += input[++index];
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; output += character; continue; }
    output += character === "?" ? `$${++parameter}` : character;
  }
  return output
    .replace(/\bAS\s+([a-z]+[A-Z][A-Za-z0-9_]*)/g, 'AS "$1"')
    .replace(/COUNT\(\*\)(?!\s*::)/gi, "COUNT(*)::int");
}

export class DopsStatement {
  private values: unknown[] = [];
  constructor(private readonly query: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async execute(executor: QueryExecutor = connection()) {
    return executor.unsafe(postgresQuery(this.query), this.values as never[]);
  }
  async all<T = Record<string, unknown>>() {
    const rows = await this.execute();
    return { success: true, results: Array.from(rows) as T[] };
  }
  async first<T = Record<string, unknown>>() {
    const rows = await this.execute();
    return (rows[0] as T | undefined) ?? null;
  }
  async run() {
    const rows = await this.execute();
    return { success: true, meta: { changes: rows.count } };
  }
}

export type DopsDatabase = ReturnType<typeof getDopsDb>;

export function getDopsDb() {
  const sql = connection();
  return {
    prepare(query: string) { return new DopsStatement(query); },
    async batch(statements: DopsStatement[]) {
      return sql.begin(async (transaction) => {
        const results = [];
        for (const statement of statements) results.push(await statement.execute(transaction));
        return results;
      });
    },
  };
}

function storageConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "dops-private";
  if (!url || !serviceKey) throw new Error("Supabase private storage is not configured.");
  return { url, serviceKey, bucket };
}

function objectUrl(key: string) {
  const { url, bucket } = storageConfig();
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`;
}

export function getDopsBucket() {
  const r2 = getR2Config();
  if (r2) {
    return getR2BucketInstance(r2);
  }
  const { serviceKey } = storageConfig();
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  return {
    async put(key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      const response = await fetch(objectUrl(key), {
        method: "POST",
        headers: { ...headers, "content-type": options?.httpMetadata?.contentType || "application/octet-stream", "x-upsert": "false" },
        body,
      });
      if (!response.ok) throw new Error(`Storage upload failed (${response.status}).`);
    },
    async get(key: string) {
      const response = await fetch(objectUrl(key), { headers, cache: "no-store" });
      if (await isNotFound(response)) return null;
      if (!response.ok) throw new Error(`Storage download failed (${response.status}).`);
      return {
        body: response.body,
        writeHttpMetadata(target: Headers) {
          target.set("content-type", response.headers.get("content-type") || "application/octet-stream");
          const length = response.headers.get("content-length");
          if (length) target.set("content-length", length);
        },
      };
    },
    async delete(key: string) {
      const response = await fetch(objectUrl(key), { method: "DELETE", headers });
      if (!response.ok && !(await isNotFound(response))) throw new Error(`Storage delete failed (${response.status}).`);
    },
    /**
     * Signed URL the BROWSER uses to upload one file straight to storage
     * (PUT, valid ~2 hours). The file never passes through a Vercel function,
     * so Vercel's 4.5 MB request limit does not apply.
     */
    async signUpload(key: string, options?: { upsert?: boolean }) {
      const { url, bucket } = storageConfig();
      const response = await fetch(`${url}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodePath(key)}`, {
        method: "POST",
        headers: { ...headers, ...(options?.upsert ? { "x-upsert": "true" } : {}) },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Storage upload signing failed (${response.status}).`);
      const data = (await response.json()) as { url?: string };
      if (!data.url) throw new Error("Storage did not return an upload URL.");
      return `${url}/storage/v1${data.url}`;
    },
    /** Short-lived signed URL to view/download one file directly from storage. */
    async signDownload(key: string, expiresInSeconds = 120, downloadName?: string) {
      const { url, bucket } = storageConfig();
      const response = await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodePath(key)}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
        cache: "no-store",
      });
      if (await isNotFound(response)) return null; // object missing
      if (!response.ok) throw new Error(`Storage download signing failed (${response.status}).`);
      const data = (await response.json()) as { signedURL?: string; signedUrl?: string };
      const path = data.signedURL ?? data.signedUrl;
      if (!path) return null;
      const signed = new URL(`${url}/storage/v1${path}`);
      if (downloadName !== undefined) signed.searchParams.set("download", downloadName);
      return signed.toString();
    },
    /**
     * Reads only the first bytes of an object plus its total size, to verify
     * an uploaded file without downloading all of it.
     */
    async probe(key: string, byteCount = 16) {
      const response = await fetch(objectUrl(key), { headers: { ...headers, range: `bytes=0-${byteCount - 1}` }, cache: "no-store" });
      if (await isNotFound(response)) return null;
      if (!response.ok) throw new Error(`Storage read failed (${response.status}).`);
      const total = Number(response.headers.get("content-range")?.split("/")[1] ?? response.headers.get("content-length") ?? NaN);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (reader && received < byteCount) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
      }
      // Don't await: inside Next.js the fetch body may be a tee'd stream whose
      // cancel() only settles when every branch is cancelled, which can hang.
      if (received >= byteCount) void reader?.cancel().catch(() => undefined);
      const head = new Uint8Array(Math.min(received, byteCount));
      let offset = 0;
      for (const chunk of chunks) {
        head.set(chunk.subarray(0, head.length - offset), offset);
        offset += Math.min(chunk.length, head.length - offset);
        if (offset >= head.length) break;
      }
      return { size: total, head };
    },
  };
}

/**
 * Supabase Storage reports a missing object either as HTTP 404 or as HTTP 400
 * with {"statusCode":"404"} in the body, depending on the version.
 * Consumes the body only for error responses.
 */
async function isNotFound(response: Response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = (await response.clone().json().catch(() => ({}))) as { statusCode?: string | number; error?: string };
  return String(body.statusCode) === "404" || /not.?found/i.test(String(body.error ?? ""));
}

function encodePath(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function jsonError(message: string, status = 400) {
  return Response.json({ success: false, message }, { status });
}

/**
 * Builds a "contains" pattern for ILIKE from user input. % and _ typed by the
 * user are matched literally (Postgres' default LIKE escape character is \).
 */
export function likePattern(input: string) {
  return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
