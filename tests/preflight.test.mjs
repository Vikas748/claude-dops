import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

test("all required DOPS API routes are present", () => {
  const routes = [
    "app/api/patients/route.ts",
    "app/api/opd/[id]/admit/route.ts",
    "app/api/clinical/route.ts",
    "app/api/ot-images/route.ts",
    "app/api/academic/route.ts",
    "app/api/special/route.ts",
    "app/api/special/columns/route.ts",
    "app/api/reports/[module]/route.ts",
    "app/api/reports/months/route.ts",
    "app/api/admin/uat/route.ts",
    "app/api/admin/system/route.ts",
    "app/api/auth/request-otp/route.ts",
    "app/api/auth/verify-otp/route.ts",
    "app/api/uploads/route.ts",
    "app/api/health/route.ts",
    "app/api/auth/logout/route.ts",
  ];
  for (const route of routes) assert.equal(existsSync(join(root, route)), true, `${route} is missing`);
});

test("monthly OPD and OT archive is generated from saved records", () => {
  const route = read("app/api/reports/months/route.ts");
  const page = read("app/page.tsx");
  assert.match(route, /substr\(visit_date,1,7\)/);
  assert.match(route, /substr\(scheduled_date,1,7\)/);
  assert.match(route, /requirePermission\(reportModule\.toUpperCase\(\), "EXPORT"\)/);
  assert.match(page, /Monthly.*report archive/);
});

test("hospital UAT checklist has 18 unique checks", () => {
  const ids = [...read("lib/uat-checks.ts").matchAll(/id:\s*"([A-Z_0-9]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 18);
  assert.equal(new Set(ids).size, ids.length);
});

test("core clinical and governance tables remain in the PostgreSQL schema", () => {
  const schema = read("supabase/schema.sql").toLowerCase();
  const tables = ["patients", "opd_visits", "ipd_admissions", "ward_stays", "ot_procedures", "ot_images", "discharge_records", "academic_documents", "special_records", "register_columns", "special_record_versions", "department_users", "audit_logs", "uat_results", "hospital_acceptance"];
  for (const table of tables) assert.match(schema, new RegExp(`create table if not exists ${table}\\b`), `${table} missing from supabase/schema.sql`);
});

test("Skin Bank supports protected custom columns and row history (no formula box)", () => {
  const route = read("app/api/special/columns/route.ts");
  const special = read("app/api/special/route.ts");
  const component = read("components/special-module.tsx");
  assert.match(route, /Official proforma columns are protected/);
  assert.match(special, /special_record_versions/);
  assert.doesNotMatch(component, /Basic formula/); // removed at the client's request
  assert.match(component, /Row version history/);
});

test("PostgreSQL migrations are ordered and safe to re-run", () => {
  const dir = join(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(files, ["001_email_otp_auth.sql", "002_direct_uploads.sql", "003_search_indexes.sql", "004_job_runs.sql", "005_optional_academic_pdf.sql", "006_device_pins.sql", "007_opd_number.sql"]);
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8").toLowerCase();
    for (const m of sql.matchAll(/create (table|index|unique index|extension|schema) (?!if not exists)/g)) assert.fail(`${file}: "${m[0]}" is not idempotent`);
  }
  assert.equal(existsSync(join(root, "drizzle")), false); // the old SQLite migrations must not come back
});

test("hospital approval is gated by complete UAT", () => {
  const route = read("app/api/admin/uat/route.ts");
  assert.match(route, /All UAT checks must pass before final approval/);
  assert.match(route, /Hospital acceptance marked/);
});

test("medical files require permissions and private caching", () => {
  const route = read("app/api/files/route.ts");
  assert.match(route, /requirePermission\(permissionModule, "VIEW"\)/);
  assert.match(route, /private, no-store/);
  // Files are served by a signed redirect that expires after 2 minutes.
  assert.match(route, /signDownload\(key, 120\)/);
  assert.match(route, /status: 302/);
});

test("uploads go directly to storage and are verified before use", () => {
  const uploads = read("lib/uploads.ts");
  const signRoute = read("app/api/uploads/route.ts");
  // Server picks the key; the client never chooses where a file lands.
  assert.match(uploads, /const key = `\$\{input\.keyPrefix\}\/\$\{crypto\.randomUUID\(\)\}/);
  // Files are checked by their real bytes, owner, purpose and expiry before being attached.
  assert.match(uploads, /matchesSignature\(intent\.contentType, probe\.head\)/);
  assert.match(uploads, /WHERE id=\? AND user_id=\? AND purpose=\? AND claimed_at IS NULL AND expires_at > now\(\)/);
  assert.match(uploads, /claimed_at=NULL/); // all-or-nothing rollback
  assert.match(signRoute, /requirePermission\(permModule, action\)/);
  for (const routePath of ["app/api/academic/route.ts", "app/api/ot-images/route.ts", "app/api/clinical/route.ts"]) {
    const route = read(routePath);
    assert.match(route, /claimUploads\(/);
    assert.doesNotMatch(route, /formData\(\)/); // no file bodies through Vercel functions
  }
  assert.match(read("supabase/migrations/002_direct_uploads.sql"), /create table if not exists upload_intents/);
});

test("clinical mutations use cross-site and rate-limit protection", () => {
  for (const routePath of ["app/api/patients/route.ts", "app/api/opd/[id]/admit/route.ts", "app/api/clinical/route.ts", "app/api/ot-images/route.ts", "app/api/special/route.ts"]) {
    const route = read(routePath);
    assert.match(route, /rejectCrossSiteMutation/);
    assert.match(route, /rateLimit/);
  }
});

test("sensitive special-register data is masked", () => {
  const route = read("app/api/special/route.ts");
  const crypto = read("lib/field-crypto.ts");
  assert.match(crypto, /aadhaar\|adhar\|account/i);
  assert.match(route, /access\.role !== "ADMIN" \? maskPayload\(p\) : p/);
});

test("Leprosy register validates identifiers and shows only total and pending", () => {
  const route = read("app/api/special/route.ts");
  const component = read("components/special-module.tsx");
  assert.match(route, /Aadhaar number must contain 12 digits/);
  assert.match(route, /Mobile number must contain 10 digits/);
  assert.match(route, /Amount Released must be YES or NO/);
  assert.match(component, /<span>Total records<\/span>/);
  assert.match(component, /<span>Release pending<\/span>/);
  assert.doesNotMatch(component, /Total released value|<span>Amount released<\/span>/);
});

test("CM Helpline cases come from the Ward only, with Pending/Resolved status", () => {
  const route = read("app/api/special/route.ts");
  const component = read("components/special-module.tsx");
  const page = read("app/page.tsx");
  const clinical = read("components/clinical-phase3.tsx");
  assert.match(route, /This patient already has an active CM Helpline case/);
  assert.match(route, /if \(source !== "WARD" \|\| !sourceRecordId\)/);
  assert.match(route, /CM Helpline cases are added from the Ward\./);
  assert.match(route, /\["PENDING", "RESOLVED"\]\.includes\(status\)/);
  assert.match(route, /patientId = current\.patientId/); // a case is never re-linked to another patient
  assert.match(clinical, /source: "WARD"/);
  assert.doesNotMatch(clinical, /source: "IPD"/);
  assert.doesNotMatch(page, /addToHelpline/);
  assert.match(component, /kind === "HELPLINE" \? <><option value="PENDING">Pending<\/option><option value="RESOLVED">Resolved<\/option><\/>/);
  assert.doesNotMatch(component, /In progress/);
  assert.match(page, /<SpecialModule key=\{active\}/); // switching registers must not keep the previous register
});

test("list modules support their required search fields", () => {
  const patients = read("app/api/patients/route.ts");
  const academic = read("app/api/academic/route.ts");
  const clinical = read("components/clinical-phase3.tsx");
  assert.match(patients, /o\.visit_date ILIKE/);
  assert.match(academic, /doctor_name ILIKE[\s\S]*document_date ILIKE/);
  assert.match(clinical, /surgeonName[\s\S]*scheduledDate/);
  assert.match(clinical, /wardName[\s\S]*bedNumber/);
});

test("Vercel hosting uses Supabase PostgreSQL and private storage", () => {
  const environment = read(".env.example");
  const adapter = read("lib/dops-db.ts");
  assert.match(environment, /SUPABASE_DATABASE_URL/);
  assert.match(environment, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(adapter, /postgres\(databaseUrl/);
  assert.match(adapter, /storage\/v1\/object/);
});

test("email OTP identity is enforced before department authorization", () => {
  const access = read("lib/access.ts");
  const auth = read("lib/auth.ts");
  const requestOtp = read("app/api/auth/request-otp/route.ts");
  const verifyOtp = read("app/api/auth/verify-otp/route.ts");
  // Codes and session tokens are only ever stored hashed.
  assert.match(auth, /createHmac\("sha256", authSecret\(\)\)/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /INSERT INTO auth_sessions \(user_id,token_hash/);
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /Bearer/);
  // Only ACTIVE users (or the bootstrap admin while none exists) receive codes.
  assert.match(requestOtp, /user\.status === "ACTIVE"/);
  assert.match(requestOtp, /DOPS_BOOTSTRAP_ADMIN_EMAIL/);
  assert.match(requestOtp, /GENERIC_REPLY/);
  assert.match(requestOtp, /otpPerIpPerHour/);
  assert.match(requestOtp, /resendCooldownSeconds/);
  // Attempts are counted atomically and codes are single use.
  assert.match(verifyOtp, /attempts = attempts \+ 1/);
  assert.match(verifyOtp, /AND attempts < max_attempts/);
  assert.match(verifyOtp, /consumed_at IS NULL RETURNING id/);
  assert.match(verifyOtp, /LOGIN_DENIED/);
  assert.match(verifyOtp, /WHERE NOT EXISTS \(SELECT 1 FROM department_users WHERE role='ADMIN' AND status='ACTIVE'\)/);
  // Status is re-checked on every request; deactivation revokes sessions.
  assert.match(access, /Authentication required/);
  assert.match(access, /PENDING/);
  assert.match(access, /deactivated/);
  assert.match(access, /revokeAllSessions/);
  assert.match(read(".env.example"), /AUTH_SECRET/);
  assert.match(read("supabase/migrations/001_email_otp_auth.sql"), /enable row level security/);
});

test("search is case-insensitive and treats % and _ literally", () => {
  for (const routePath of ["app/api/patients/route.ts", "app/api/academic/route.ts", "app/api/special/route.ts"]) {
    const route = read(routePath);
    assert.match(route, / ILIKE \?/);
    assert.doesNotMatch(route, /[^I]LIKE \?/);
    assert.match(route, /likePattern\(q\)/);
  }
  assert.match(read("supabase/migrations/003_search_indexes.sql"), /gin_trgm_ops/);
});

test("reports work on PostgreSQL and print Hindi correctly", () => {
  const route = read("app/api/reports/[module]/route.ts");
  const reports = read("lib/reports.ts");
  // SQLite-style 'quoted' aliases are a syntax error on PostgreSQL (reports used to return 500).
  assert.doesNotMatch(reports, /AS '/);
  assert.match(route, /loadReport\(/);
  assert.match(reports, /Hind-Regular\.ttf/);
  assert.match(reports, /Page \$\{i - range\.start \+ 1\} of \$\{range\.count\}/);
  assert.match(reports, /periodLabel/);
  assert.match(reports, /ReportInputError\("A report can cover at most one year\."\)/);
  const config = read("next.config.ts");
  assert.match(config, /serverExternalPackages: \["pdfkit"\]/);
  assert.match(config, /assets\/fonts/);
  assert.equal(existsSync(join(root, "assets/fonts/Hind-Regular.ttf")), true);
  assert.equal(existsSync(join(root, "assets/fonts/OFL.txt")), true);
});

test("spreadsheet exports are formula-safe and keep ID numbers exact", () => {
  const security = read("lib/security.ts");
  assert.match(security, /\/\^\[=\+\\-@\\t\\r\]\//);
  assert.match(security, /isFragileDigitString/);
  const xlsx = read("lib/xlsx.ts");
  assert.match(xlsx, /t="inlineStr"/); // text cells can never be formulas
  assert.match(xlsx, /digits\.length <= 10/); // Aadhaar/bank numbers stay text
  const special = read("app/api/special/route.ts");
  assert.match(special, /buildXlsx\(/);
  assert.match(special, /spreadsheetml\.sheet/);
  assert.doesNotMatch(special, /application\/vnd\.ms-excel/);
  for (const routePath of ["app/api/special/route.ts", "app/api/admin/uat/route.ts", "lib/reports.ts"])
    assert.match(read(routePath), /csvCell/);
});

test("scheduled jobs are protected, idempotent and scheduled in Vercel", () => {
  const route = read("app/api/cron/[job]/route.ts");
  const jobs = read("lib/jobs.ts");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /const force = who === "admin"/); // a repeated cron call can never force a resend
  assert.match(jobs, /ON CONFLICT DO NOTHING RETURNING job/);
  assert.match(jobs, /releaseRun/);
  assert.match(jobs, /bcc: recipients/);
  assert.match(jobs, /REPORT_EMAILS/);
  const vercel = JSON.parse(read("vercel.json"));
  const paths = vercel.crons.map((c) => c.path);
  assert.deepEqual(paths.sort(), ["/api/cron/daily", "/api/cron/monthly-reports"]);
  assert.match(read("supabase/migrations/004_job_runs.sql"), /primary key \(job, run_key\)/);
  assert.match(read("app/api/clinical/route.ts"), /Enter the OT time as HH:MM/);
});

test("business dates use India time, not UTC; greeting is not hard-coded", () => {
  for (const p of ["app/api/patients/route.ts", "app/api/opd/[id]/admit/route.ts", "app/api/clinical/route.ts", "app/api/special/route.ts"])
    assert.doesNotMatch(read(p), /now\.slice\(0, 10\)/, `${p} uses the UTC date`);
  assert.match(read("app/api/patients/route.ts"), /istYear\(\)/);
  for (const p of ["app/page.tsx", "components/clinical-phase3.tsx"])
    assert.doesNotMatch(read(p), /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, `${p} uses the UTC date`);
  const page = read("app/page.tsx");
  assert.doesNotMatch(page, /Dr\. Sharma/);
  assert.match(page, /greetingFor\(userName\)/);
});

test("Aadhaar and bank account numbers are encrypted at rest and masked for non-admins", () => {
  const crypto = read("lib/field-crypto.ts");
  assert.match(crypto, /aes-256-gcm/);
  assert.match(crypto, /setAAD/);
  const special = read("app/api/special/route.ts");
  assert.match(special, /encryptPayload\(savedPayload\)/);
  assert.match(special, /decryptPayload\(/);
  assert.match(special, /looksMasked\(incoming\[key\]\)/); // masked edits never overwrite real numbers
  const history = read("app/api/special/columns/route.ts");
  assert.match(history, /requirePermission\(historyModule, "VIEW"\)/);
  assert.match(history, /maskPayload/);
  assert.match(read("app/api/health/route.ts"), /DATA_ENCRYPTION_KEY/);
});

test("an ended session anywhere in the app returns the user to sign-in", () => {
  const guard = read("components/session-guard.tsx");
  assert.match(guard, /response\.status === 401/);
  assert.match(guard, /\/api\/auth\/logout\?reason=expired/);
  assert.match(guard, /"\/api\/auth\/"/); // sign-in endpoints are excluded (wrong code must not redirect)
  assert.match(read("app/layout.tsx"), /<SessionGuard\/>/);
});

test("audit log records who changed what, covers exports, and survives restores", () => {
  const admin = read("app/api/admin/route.ts");
  assert.match(admin, /role \$\{before\.role\} → \$\{role\}/);
  assert.match(admin, /permissions added:/);
  assert.match(admin, /INSERT INTO department_users [^"]*RETURNING id/);
  assert.match(read("app/api/patients/[id]/route.ts"), /Patient details edited: \$\{changed\.join/);
  const special = read("app/api/special/route.ts");
  assert.match(special, /changedFields/);
  assert.match(special, /'EXPORT'/);
  assert.match(read("app/api/reports/[module]/route.ts"), /'EXPORT'/);
  const system = read("app/api/admin/system/route.ts");
  assert.match(system, /if \(table !== "audit_logs"\) statements\.push\(db\.prepare\(`DELETE FROM/);
  assert.match(system, /WHERE NOT EXISTS \(SELECT 1 FROM audit_logs/);
});

test("Class / Research / Publication: PDF optional at creation, added or replaced later", () => {
  const route = read("app/api/academic/route.ts");
  const ui = read("components/academic-module.tsx");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /requirePermission\(d\.kind, "EDIT"\)/);
  assert.match(route, /const file = b\.uploadId\s*\?/); // upload is optional
  assert.doesNotMatch(route, /select a PDF/i);
  assert.match(ui, /method: editing \? "PATCH" : "POST"/);
  assert.doesNotMatch(ui, /accept="application\/pdf,\.pdf"\s*required/);
  assert.match(read("supabase/migrations/005_optional_academic_pdf.sql"), /alter column file_key\s+drop not null/);
});

test("brand, landing page and account requests", () => {
  const login = read("app/login/page.tsx");
  const req = read("app/api/auth/request-account/route.ts");
  assert.match(login, /\/brand\/dops-logo-full\.png/);
  assert.match(login, /Request an account/);
  assert.match(req, /'PENDING','\[\]'/); // requests never get access by themselves
  assert.match(req, /const ROLES = \["DOCTOR", "RESIDENT", "NURSE", "STAFF"\]/); // no self-requested ADMIN
  assert.match(req, /website/); // honeypot
  assert.match(read("app/api/admin/route.ts"), /Your DOPS access is ready/);
  assert.match(read("proxy.ts"), /brand\//); // logo must load before sign-in
  assert.equal(existsSync(join(root, "public/brand/dops-logo-full.png")), true);
  assert.match(read("public/manifest.webmanifest"), /icon-512\.png/);
});

test("device PIN: bound to the device, hashed, locked after 5 attempts", () => {
  const lib = read("lib/device-pin.ts");
  const route = read("app/api/auth/pin/route.ts");
  assert.match(lib, /scryptSync/);
  assert.match(lib, /httpOnly: true/);
  assert.match(lib, /WHERE id = \? AND locked_at IS NULL/); // attempt is claimed before the PIN is checked
  assert.match(lib, /PIN_MAX_ATTEMPTS = 5/);
  assert.match(route, /device\.status !== "ACTIVE"/);
  assert.match(route, /weakPinReason/);
  assert.match(read("app/api/auth/verify-otp/route.ts"), /offerPin/);
  assert.doesNotMatch(read("app/login/page.tsx"), /Skip for now/); // PIN is mandatory
});

test("app lock: PIN on every open, enforced by the server", () => {
  const auth = read("lib/auth.ts");
  const access = read("lib/access.ts");
  const guard = read("components/session-guard.tsx");
  const pin = read("app/api/auth/pin/route.ts");
  assert.match(auth, /UNLOCK_COOKIE = "dops_unlock"/);
  assert.match(auth, /no maxAge \/ expires: a session cookie/);
  assert.match(access, /DOPS is locked\. Enter your PIN to continue\.", 423/);
  assert.match(guard, /sessionStorage/);
  assert.match(guard, /response\.status === 423/);
  assert.match(pin, /hasPinSetupTicket\(user\.sessionId\)/); // a locked device cannot set a new PIN without a fresh email code
  assert.match(read("app/api/auth/verify-otp/route.ts"), /requirePin/);
  assert.doesNotMatch(read("proxy.ts"), /signedIn && publicAuthPage/);
});

test("round 3: OPD No./UHID No. required and unique; DD-MM-YYYY; headings without labels", () => {
  const post = read("app/api/patients/route.ts");
  const patch = read("app/api/patients/[id]/route.ts");
  for (const r of [post, patch]) {
    assert.match(r, /readOpdNumber\(b\.opdNumber\)/);
    assert.match(r, /duplicateOpdMessage/);
  }
  assert.match(post, /p\.opd_number ILIKE \?/); // searchable
  assert.match(read("supabase/migrations/007_opd_number.sql"), /create unique index if not exists idx_patients_opd_number_unique/);
  assert.match(read("lib/dates.ts"), /export function formatDate/);
  assert.match(read("lib/reports.ts"), /return `\$\{d\}-\$\{m\}-\$\{y\}`/);
  for (const f of ["app/page.tsx", "components/clinical-phase3.tsx", "components/academic-module.tsx", "components/special-module.tsx", "components/admin-module.tsx"]) {
    const s = read(f);
    assert.doesNotMatch(s, /className="eyebrow">(CLINICAL WORKSPACE|ACADEMIC WORKSPACE|SPECIAL REGISTERS|ACCESS CONTROL)</);
    assert.match(s, /className="section-title"/);
  }
  assert.match(read("app/page.tsx"), /title="ACADEMIC WORKSPACE"/);
  assert.doesNotMatch(read("app/page.tsx"), /Patient ID continuity|<h2>Production readiness<\/h2>/);
  assert.match(read("components/special-module.tsx"), /\{!isSkin && <th>Status<\/th>\}/);
});
