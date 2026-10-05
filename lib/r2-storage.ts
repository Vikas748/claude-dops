import crypto from "node:crypto";
import process from "node:process";
import { Buffer } from "node:buffer";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl?: string; // Optional custom domain if user sets one
}

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim() || "dops-private";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, "");
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256(data: string | Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function toAmzDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return { dateStamp: `${y}${m}${d}`, amzDate: `${y}${m}${d}T${hh}${mm}${ss}Z` };
}

function r2Endpoint(accountId: string) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function encodeR2Path(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Generates S3 SigV4 Presigned URL for Cloudflare R2 */
export function generateR2PresignedUrl(options: {
  config: R2Config;
  key: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  expiresInSeconds?: number;
  extraQueryParams?: Record<string, string>;
}): string {
  const { config, key, method } = options;
  const expiresIn = options.expiresInSeconds || 3600;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const { dateStamp, amzDate } = toAmzDate(now);

  const endpoint = r2Endpoint(config.accountId);
  const host = new URL(endpoint).host;
  const canonicalUri = `/${encodeURIComponent(config.bucket)}/${encodeR2Path(key)}`;

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${dateStamp}/${region}/${service}/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
    ...(options.extraQueryParams || {}),
  };

  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + config.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `${endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/** Signs a direct HTTP fetch request with AWS SigV4 headers for Cloudflare R2 */
function signR2Request(options: {
  config: R2Config;
  key: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  body?: ArrayBuffer | Buffer | string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}) {
  const { config, key, method } = options;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const { dateStamp, amzDate } = toAmzDate(now);

  const endpoint = r2Endpoint(config.accountId);
  const host = new URL(endpoint).host;
  const canonicalUri = `/${encodeURIComponent(config.bucket)}/${encodeR2Path(key)}`;

  let bodyBuffer: Buffer;
  if (!options.body) {
    bodyBuffer = Buffer.alloc(0);
  } else if (options.body instanceof Buffer) {
    bodyBuffer = options.body;
  } else if (typeof options.body === "string") {
    bodyBuffer = Buffer.from(options.body, "utf8");
  } else {
    bodyBuffer = Buffer.from(new Uint8Array(options.body));
  }

  const payloadHash = sha256(bodyBuffer);

  const allHeaders: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...(options.headers || {}),
  };

  const sortedHeaderKeys = Object.keys(allHeaders).map((k) => k.toLowerCase()).sort();
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${allHeaders[k].trim()}\n`).join("");

  const queryParams = options.queryParams || {};
  const sortedQueryKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedQueryKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + config.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authHeader = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = canonicalQueryString ? `${endpoint}${canonicalUri}?${canonicalQueryString}` : `${endpoint}${canonicalUri}`;

  return {
    url,
    headers: {
      ...allHeaders,
      authorization: authHeader,
    },
    body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(bodyBuffer),
  };
}

export function getR2BucketInstance(config: R2Config) {
  return {
    async put(key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      const signed = signR2Request({
        config,
        key,
        method: "PUT",
        body,
        headers: {
          "content-type": options?.httpMetadata?.contentType || "application/octet-stream",
        },
      });

      const response = await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body: signed.body,
      });

      if (!response.ok) {
        throw new Error(`Cloudflare R2 upload failed (${response.status}).`);
      }
    },

    async get(key: string) {
      const signed = signR2Request({ config, key, method: "GET" });
      const response = await fetch(signed.url, { headers: signed.headers, cache: "no-store" });

      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Cloudflare R2 download failed (${response.status}).`);

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
      const signed = signR2Request({ config, key, method: "DELETE" });
      const response = await fetch(signed.url, { method: "DELETE", headers: signed.headers });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Cloudflare R2 delete failed (${response.status}).`);
      }
    },

    async signUpload(key: string) {
      // 2 hours validity for browser upload
      return generateR2PresignedUrl({
        config,
        key,
        method: "PUT",
        expiresInSeconds: 7200,
      });
    },

    async signDownload(key: string, expiresInSeconds = 120, downloadName?: string) {
      const extraQueryParams: Record<string, string> = {};
      if (downloadName !== undefined) {
        extraQueryParams["response-content-disposition"] = `attachment; filename="${downloadName.replace(/"/g, "")}"`;
      }

      return generateR2PresignedUrl({
        config,
        key,
        method: "GET",
        expiresInSeconds,
        extraQueryParams,
      });
    },

    async probe(key: string, byteCount = 16) {
      const signed = signR2Request({
        config,
        key,
        method: "GET",
        headers: { range: `bytes=0-${byteCount - 1}` },
      });

      const response = await fetch(signed.url, { headers: signed.headers, cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok && response.status !== 206) {
        throw new Error(`Cloudflare R2 read failed (${response.status}).`);
      }

      const total = Number(
        response.headers.get("content-range")?.split("/")[1] ??
          response.headers.get("content-length") ??
          NaN
      );

      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (reader && received < byteCount) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
      }

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
