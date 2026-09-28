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
