import { getDopsBucket, getDopsDb } from "@/lib/dops-db";
import { getDopsAccess, isResponse } from "@/lib/access";
import { verifyMailer } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * Deployment self-test.
 *
 *   GET /api/health            quick check (public): settings present, database
 *                              reachable, migrations applied, storage reachable.
 *   GET /api/health?deep=1     also logs in to SMTP and does a real storage
 *                              upload/download/delete round trip. Allowed for a
 *                              signed-in Admin, or with ?token=HEALTH_CHECK_TOKEN
 *                              (useful when sign-in itself is broken).
 *
 * Public output never includes secret values or raw error messages.
 */
const REQUIRED_ENV = [
  "SUPABASE_DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_SECRET",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "DOPS_BOOTSTRAP_ADMIN_EMAIL",
  "CRON_SECRET",
  "DATA_ENCRYPTION_KEY",
];
const MIGRATION_TABLES: Record<string, string> = {
  "schema.sql": "department_users",
  "001_email_otp_auth.sql": "auth_sessions",
  "002_direct_uploads.sql": "upload_intents",
  "003_search_indexes.sql": "idx_patients_name_trgm",
  "004_job_runs.sql": "job_runs",
  "006_device_pins.sql": "auth_devices",
};
// Migrations that change columns rather than add tables: SQL returning "present".
const MIGRATION_QUERIES: Record<string, string> = {
  "008_polish_round.sql":
    "SELECT COUNT(*) > 0 AS present FROM information_schema.columns WHERE table_schema='public' AND table_name='opd_visits' AND column_name='visit_type'",
  "007_opd_number.sql":
    "SELECT COUNT(*) > 0 AS present FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name='opd_number'",
  "005_optional_academic_pdf.sql":
    "SELECT is_nullable = 'YES' AS present FROM information_schema.columns WHERE table_schema='public' AND table_name='academic_documents' AND column_name='file_key'",
};

type Check = { ok: boolean; detail?: string; ms?: number; skipped?: boolean };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

async function timed(run: () => Promise<string | void>): Promise<Check> {
  const start = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - start, ...(detail ? { detail } : {}) };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, detail: errorText(error) };
  }
}

async function deepAllowed(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const expected = process.env.HEALTH_CHECK_TOKEN?.trim();
  if (token && expected && expected.length >= 16 && token === expected) return true;
  try {
    const access = await getDopsAccess();
    return !isResponse(access) && access.role === "ADMIN";
  } catch {
    return false;
  }
}

async function storageRoundTrip() {
  const bucket = getDopsBucket();
  const key = `health/probe-${crypto.randomUUID()}.txt`;
  const payload = `dops-health ${new Date().toISOString()}`;
  try {
    // Same path the browser uses: signed upload URL, then signed download URL.
    const uploadUrl = await bucket.signUpload(key);
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: payload });
    if (!put.ok) throw new Error(`signed upload returned ${put.status}`);
    const probe = await bucket.probe(key, 11);
    if (!probe || new TextDecoder().decode(probe.head) !== "dops-health") throw new Error("uploaded file could not be read back");
    const downloadUrl = await bucket.signDownload(key, 60);
    if (!downloadUrl) throw new Error("signed download URL not issued");
    const get = await fetch(downloadUrl, { cache: "no-store" });
    if (!get.ok || (await get.text()) !== payload) throw new Error(`signed download returned ${get.status}`);
    return "signed upload, verify, signed download all worked";
  } finally {
    await bucket.delete(key).catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const wantsDeep = new URL(request.url).searchParams.get("deep") === "1";
  const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  const secretLength = process.env.AUTH_SECRET?.trim().length ?? 0;
  const encKey = process.env.DATA_ENCRYPTION_KEY?.trim();
  const encKeyBad = Boolean(encKey) && Buffer.from(encKey!, "base64").length !== 32;

  const checks: Record<string, Check> = {
    settings: {
      ok: missingEnv.length === 0 && secretLength >= 32 && !encKeyBad,
      ...(missingEnv.length || secretLength < 32 || encKeyBad
        ? {
            detail: [
              missingEnv.length ? `missing: ${missingEnv.join(", ")}` : "",
              secretLength && secretLength < 32 ? "AUTH_SECRET shorter than 32 characters" : "",
              encKeyBad ? "DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded" : "",
            ].filter(Boolean).join("; "),
          }
        : {}),
    },
  };

  checks.database = await timed(async () => {
    await getDopsDb().prepare("SELECT 1 AS ok").first();
  });

  if (checks.database.ok) {
    checks.migrations = await timed(async () => {
      const missing: string[] = [];
      for (const [file, table] of Object.entries(MIGRATION_TABLES)) {
        const row = await getDopsDb().prepare("SELECT to_regclass(?) IS NOT NULL AS present").bind(`public.${table}`).first<{ present: boolean }>();
        if (!row?.present) missing.push(file);
      }
      for (const [file, query] of Object.entries(MIGRATION_QUERIES)) {
        const row = await getDopsDb().prepare(query).first<{ present: boolean }>();
        if (!row?.present) missing.push(file);
      }
      if (missing.length) throw new Error(`not applied: ${missing.join(", ")}`);
    });
  } else {
    checks.migrations = { ok: false, skipped: true, detail: "database unreachable" };
  }

  // Signing a URL proves the service key and bucket are right, without writing anything.
  checks.storage = await timed(async () => {
    await getDopsBucket().signUpload(`health/sign-only-${crypto.randomUUID()}.txt`);
  });

  const deep = wantsDeep && (await deepAllowed(request));
  if (deep) {
    checks.storageRoundTrip = checks.storage.ok ? await timed(storageRoundTrip) : { ok: false, skipped: true, detail: "storage unreachable" };
    checks.email = await timed(async () => {
      const result = await verifyMailer();
      if (!result.ok) throw new Error(result.error);
      return "SMTP login succeeded";
    });
  }

  const ok = Object.values(checks).every((check) => check.ok);
  // Raw error messages are only shown to an admin / token holder.
  const shown = Object.fromEntries(
    Object.entries(checks).map(([name, check]) => [
      name,
      deep || name === "settings" || name === "migrations" ? check : { ok: check.ok, ...(check.ms !== undefined ? { ms: check.ms } : {}) },
    ]),
  );
  return Response.json(
    {
      ok,
      mode: deep ? "deep" : "quick",
      ...(wantsDeep && !deep ? { note: "Deep check needs an Admin session or ?token=HEALTH_CHECK_TOKEN." } : {}),
      region: process.env.VERCEL_REGION ?? "local",
      checkedAt: new Date().toISOString(),
      checks: shown,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
