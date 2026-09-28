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
