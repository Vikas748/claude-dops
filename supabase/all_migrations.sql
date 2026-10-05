-- DOPS Combined Migrations (001 to 008)

-- >>> 001_email_otp_auth.sql <<<
-- DOPS migration 001: self-hosted email OTP authentication (replaces Supabase magic link)
-- Safe to run more than once. Run in Supabase SQL Editor AFTER supabase/schema.sql.
-- Timestamps here use timestamptz (not text) because expiry checks must be
-- done by the database clock, independent of Vercel instance clocks.

-- One row per OTP sent. The code itself is never stored, only an HMAC of it.
create table if not exists auth_otps (
  id            bigserial primary key,
  email         text        not null,                 -- always stored lower-case
  code_hash     text        not null,                 -- HMAC-SHA256(AUTH_SECRET, email:code)
  attempts      integer     not null default 0,       -- wrong guesses so far
  max_attempts  integer     not null default 5,
  request_ip    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,                 -- typically now() + 10 minutes
  consumed_at   timestamptz,                          -- set on success OR when superseded
  constraint auth_otps_email_lowercase check (email = lower(email)),
  constraint auth_otps_attempts_range  check (attempts >= 0 and attempts <= max_attempts)
);
-- "Latest active OTP for this email" lookup, and per-email send-rate counting
create index if not exists idx_auth_otps_email_created on auth_otps (email, created_at desc);
-- Per-IP send-rate counting
create index if not exists idx_auth_otps_ip_created    on auth_otps (request_ip, created_at desc);
-- Periodic cleanup of old rows
create index if not exists idx_auth_otps_expires       on auth_otps (expires_at);

-- One row per signed-in device. The raw token lives only in the cookie / app;
-- the DB keeps its SHA-256 hash, so a DB leak cannot be replayed as a login.
create table if not exists auth_sessions (
  id            bigserial primary key,
  user_id       integer     not null references department_users(id) on delete cascade,
  token_hash    text        not null unique,
  client        text        not null default 'WEB',   -- WEB | MOBILE (future app)
  user_agent    text,
  ip            text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,                          -- logout / admin deactivation
  constraint auth_sessions_client_valid check (client in ('WEB','MOBILE'))
);
create index if not exists idx_auth_sessions_user    on auth_sessions (user_id);
create index if not exists idx_auth_sessions_expires on auth_sessions (expires_at);

-- Same security model as every other DOPS table: RLS on, no public policies.
-- Only the Vercel backend (direct Postgres connection) can read/write these.
alter table auth_otps     enable row level security;
alter table auth_sessions enable row level security;

-- Email is now the login identity, so enforce case-insensitive uniqueness.
create unique index if not exists idx_users_email_lower on department_users (lower(email));


-- >>> 002_direct_uploads.sql <<<
-- DOPS migration 002: direct browser-to-storage uploads.
-- Safe to run more than once. Run in Supabase SQL Editor after 001.
--
-- Files no longer pass through Vercel functions (4.5 MB request limit).
-- The server issues a signed upload URL and records it here; the file is only
-- attached to a patient/document after the server has verified it in storage.

create table if not exists upload_intents (
  id            uuid        primary key default gen_random_uuid(),
  user_id       integer     references department_users(id) on delete set null, -- kept if users are restored, so cleanup still runs
  purpose       text        not null,       -- ACADEMIC | OT_IMAGE | DISCHARGE_CARD | BACKUP_EXPORT | RESTORE_PACKAGE
  file_key      text        not null unique, -- storage object key, chosen by the server
  file_name     text        not null,        -- original name, for display only
  content_type  text        not null,
  declared_size bigint      not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,        -- upload must be attached before this
  claimed_at    timestamptz,                 -- set when attached to a record
  constraint upload_intents_purpose_valid check (purpose in ('ACADEMIC','OT_IMAGE','DISCHARGE_CARD','BACKUP_EXPORT','RESTORE_PACKAGE'))
);
-- Housekeeping: find never-attached uploads so their files can be deleted.
create index if not exists idx_upload_intents_unclaimed on upload_intents (created_at) where claimed_at is null;
create index if not exists idx_upload_intents_user on upload_intents (user_id);

alter table upload_intents enable row level security;

-- A restore deletes and re-creates department_users. Tracking rows must
-- survive that, or unattached files (including full-data backup exports)
-- would never be cleaned up. (Also fixes databases that ran an earlier draft.)
alter table upload_intents alter column user_id drop not null;
alter table upload_intents drop constraint if exists upload_intents_user_id_fkey;
alter table upload_intents add constraint upload_intents_user_id_fkey
  foreign key (user_id) references department_users(id) on delete set null;

-- Hard ceiling enforced by Supabase itself, independent of the app (50 MB).
-- Per-type limits (PDF 15 MB, image 8 MB, etc.) are enforced by the app.
update storage.buckets set file_size_limit = 52428800 where id = 'dops-private';


-- >>> 003_search_indexes.sql <<<
-- DOPS migration 003: fast case-insensitive "contains" search.
-- Safe to run more than once. Run in Supabase SQL Editor after 002.
--
-- Search uses ILIKE '%text%'. Ordinary indexes cannot help with a leading %,
-- so these trigram indexes keep name/diagnosis/mobile search fast as the
-- patient list grows into the tens of thousands.

create schema if not exists extensions;          -- already present on Supabase
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_patients_name_trgm      on patients     using gin (name      extensions.gin_trgm_ops);
create index if not exists idx_patients_mobile_trgm    on patients     using gin (mobile    extensions.gin_trgm_ops);
create index if not exists idx_opd_diagnosis_trgm      on opd_visits   using gin (diagnosis extensions.gin_trgm_ops);
create index if not exists idx_academic_title_trgm     on academic_documents using gin (title       extensions.gin_trgm_ops);
create index if not exists idx_academic_doctor_trgm    on academic_documents using gin (doctor_name extensions.gin_trgm_ops);
create index if not exists idx_special_name_trgm       on special_records using gin (primary_name extensions.gin_trgm_ops);


-- >>> 004_job_runs.sql <<<
-- DOPS migration 004: scheduled jobs (monthly report email, daily OT reminder).
-- Safe to run more than once. Run in Supabase SQL Editor after 003.
--
-- Vercel Cron may call a job more than once. Each run claims a unique
-- (job, run_key) row first, e.g. ('monthly-reports', '2026-09'), so the
-- same month's report is emailed only once.

create table if not exists job_runs (
  job         text        not null,
  run_key     text        not null,
  status      text        not null default 'RUNNING',   -- RUNNING | DONE
  detail      text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  primary key (job, run_key),
  constraint job_runs_status_valid check (status in ('RUNNING','DONE'))
);

alter table job_runs enable row level security;


-- >>> 005_optional_academic_pdf.sql <<<
-- DOPS migration 005: client change round 1.
-- Safe to run more than once. Run in Supabase SQL Editor after 004.

-- 1) Class / Research / Publication entries can be added first and the PDF
--    uploaded later (Edit), so the file columns become optional.
alter table academic_documents alter column file_key  drop not null;
alter table academic_documents alter column file_name drop not null;

-- 2) CM Helpline now has only Pending and Resolved.
update special_records set status = 'PENDING'
 where kind = 'HELPLINE' and status = 'IN_PROGRESS';


-- >>> 006_device_pins.sql <<<
-- DOPS migration 006: quick sign-in with a 4-digit PIN on a trusted device.
-- Safe to run more than once. Run in Supabase SQL Editor after 005.
--
-- After a normal email-code sign-in, a user may set a PIN for THIS device.
-- The browser keeps a random device token (httpOnly cookie); the database keeps
-- only its hash and a slow, salted hash of the PIN. A PIN therefore works only
-- on the device where it was set, and is locked after 5 wrong attempts.

create table if not exists auth_devices (
  id              bigserial   primary key,
  user_id         integer     not null references department_users(id) on delete cascade,
  token_hash      text        not null unique,   -- SHA-256 of the device cookie
  pin_hash        text        not null,          -- scrypt(salt, AUTH_SECRET-peppered PIN)
  failed_attempts integer     not null default 0,
  locked_at       timestamptz,                   -- set after 5 wrong PINs; email code needed
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);
create index if not exists idx_auth_devices_user on auth_devices (user_id);

alter table auth_devices enable row level security;


-- >>> 007_opd_number.sql <<<
-- DOPS migration 007: OPD No. / UHID No. for every patient.
-- Safe to run more than once. Run in Supabase SQL Editor after 006.
--
-- Required for new and edited patients (checked by the app). Existing patients
-- keep an empty value until they are next edited. Two active patients can never
-- share the same number (letters are compared case-insensitively).

alter table patients add column if not exists opd_number text;

create unique index if not exists idx_patients_opd_number_unique
  on patients (lower(opd_number))
  where deleted_at is null and opd_number is not null and opd_number <> '';

-- Fast "contains" search on the number from the dashboard/OPD search box.
create index if not exists idx_patients_opd_number_trgm
  on patients using gin (opd_number extensions.gin_trgm_ops);


-- >>> 008_polish_round.sql <<<
-- DOPS migration 008: polishing round.
-- Safe to run more than once. Run in Supabase SQL Editor after 007.

-- 1) IPD "CASE CATEGORY": MLC (medico-legal case) or NON-MLC. Shown in IPD and Ward.
alter table ipd_admissions add column if not exists case_category text;
alter table ipd_admissions drop constraint if exists ipd_case_category_valid;
alter table ipd_admissions add constraint ipd_case_category_valid
  check (case_category is null or case_category in ('MLC', 'NON-MLC'));

-- 2) Ward "STATUS" on leaving the ward: DISCHARGED, LAMA (left against medical
--    advice), DOR (discharge on request), DAMA (discharged against medical advice).
alter table ward_stays add column if not exists discharge_status text;
alter table ward_stays drop constraint if exists ward_discharge_status_valid;
alter table ward_stays add constraint ward_discharge_status_valid
  check (discharge_status is null or discharge_status in ('DISCHARGED', 'LAMA', 'DOR', 'DAMA'));
-- Patients already discharged before this change count as DISCHARGED.
update ward_stays set discharge_status = 'DISCHARGED' where discharged_at is not null and discharge_status is null;

-- 3) Emergency OPD: an OPD visit is either a regular OPD visit or an Emergency OPD visit.
alter table opd_visits add column if not exists visit_type text not null default 'OPD';
alter table opd_visits drop constraint if exists opd_visit_type_valid;
alter table opd_visits add constraint opd_visit_type_valid check (visit_type in ('OPD', 'EMERGENCY'));
create index if not exists idx_opd_visits_type_date on opd_visits (visit_type, visit_date);


