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
