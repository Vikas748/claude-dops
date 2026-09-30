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
