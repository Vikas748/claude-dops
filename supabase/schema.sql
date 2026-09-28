-- Run once in Supabase SQL Editor before deploying DOPS.
-- All application tables have RLS enabled with no public policies. The Vercel
-- backend connects through SUPABASE_DATABASE_URL; browsers never query them directly.

create table if not exists patients (
  id serial primary key, patient_code text not null unique, name text not null,
  age integer not null, sex text not null, mobile text not null, address text not null,
  created_at text not null, updated_at text not null, deleted_at text
);
create index if not exists idx_patients_name on patients(name);
create index if not exists idx_patients_mobile on patients(mobile);

create table if not exists opd_visits (
  id serial primary key, patient_id integer not null references patients(id),
  diagnosis text not null, visit_date text not null, status text not null default 'OPD',
  created_at text not null, updated_at text not null, deleted_at text
);
create index if not exists idx_opd_visit_date on opd_visits(visit_date);
create index if not exists idx_opd_patient_id on opd_visits(patient_id);
create index if not exists idx_opd_diagnosis on opd_visits(diagnosis);

create table if not exists ipd_admissions (
  id serial primary key, patient_id integer not null references patients(id),
  opd_visit_id integer not null unique references opd_visits(id), diagnosis text not null,
  admission_date text not null, plan_management text not null default '', ayushman_code text not null default '',
  status text not null default 'ADMITTED', created_at text not null, updated_at text not null
);
create index if not exists idx_ipd_status on ipd_admissions(status);
create index if not exists idx_ipd_patient_id on ipd_admissions(patient_id);

create table if not exists ward_stays (
  id serial primary key, ipd_id integer not null unique references ipd_admissions(id),
  ward_name text not null, bed_number text not null, pac_status text not null default 'PENDING',
  admitted_at text not null, discharged_at text, updated_at text not null
);
create index if not exists idx_ward_active on ward_stays(discharged_at);
create index if not exists idx_ward_pac on ward_stays(pac_status);

create table if not exists ot_procedures (
  id serial primary key, ipd_id integer not null references ipd_admissions(id),
  scheduled_date text not null, scheduled_time text not null, procedure_name text not null,
  surgeon_name text not null, pac_status text not null default 'PENDING', status text not null default 'SCHEDULED',
  created_at text not null, updated_at text not null
);
create index if not exists idx_ot_scheduled_date on ot_procedures(scheduled_date);
create index if not exists idx_ot_ipd_id on ot_procedures(ipd_id);

create table if not exists ot_images (
  id serial primary key, ot_id integer not null references ot_procedures(id), image_type text not null,
  file_key text not null unique, file_name text not null, mime_type text not null, size_bytes integer not null,
  created_at text not null, deleted_at text
);
create index if not exists idx_ot_images_ot_type on ot_images(ot_id,image_type);

create table if not exists discharge_records (
  id serial primary key, ipd_id integer not null unique references ipd_admissions(id),
  discharge_date text not null, notes text not null default '', card_key text, card_name text, created_at text not null
);
create index if not exists idx_discharge_date on discharge_records(discharge_date);

create table if not exists academic_documents (
  id serial primary key, kind text not null, title text not null, doctor_name text not null,
  document_date text not null, file_key text not null, file_name text not null, external_url text,
  created_at text not null, deleted_at text
);
create index if not exists idx_academic_kind_date on academic_documents(kind,document_date);
create index if not exists idx_academic_doctor on academic_documents(doctor_name);

create table if not exists special_records (
  id serial primary key, kind text not null, patient_id integer references patients(id),
  record_date text not null, primary_name text not null, status text not null default 'ACTIVE',
  payload text not null, created_at text not null, updated_at text not null, deleted_at text
);
create index if not exists idx_special_kind_date on special_records(kind,record_date);
create index if not exists idx_special_patient on special_records(patient_id);

create table if not exists register_columns (
  id serial primary key, kind text not null, name text not null, data_type text not null default 'TEXT',
  position integer not null default 0, created_at text not null, deleted_at text
);
create index if not exists idx_register_columns_kind on register_columns(kind);

create table if not exists special_record_versions (
  id serial primary key, record_id integer not null, kind text not null, primary_name text not null,
  status text not null, payload text not null, changed_by text not null, created_at text not null
);
create index if not exists idx_special_versions_record on special_record_versions(record_id);

create table if not exists department_users (
  id serial primary key, user_key text unique, name text not null, email text not null unique, mobile text,
  role text not null default 'RESIDENT', status text not null default 'PENDING', permissions text not null default '[]',
  created_at text not null, updated_at text not null, last_login text
);
create index if not exists idx_users_status on department_users(status);
create index if not exists idx_users_role on department_users(role);

create table if not exists audit_logs (
  id serial primary key, action text not null, module text not null, record_id integer,
  details text not null default '', created_at text not null
);
create index if not exists idx_audit_created_at on audit_logs(created_at);

create table if not exists uat_results (
  id text primary key, status text not null default 'NOT_TESTED', notes text not null default '',
  tested_by text, tested_at text, updated_at text not null
);
create index if not exists idx_uat_status on uat_results(status);

create table if not exists hospital_acceptance (
  id integer primary key, department_representative text not null, it_representative text not null,
  decision text not null, limitations text not null default '', accepted_by text not null,
  accepted_at text not null, updated_at text not null
);

alter table patients enable row level security;
alter table opd_visits enable row level security;
alter table ipd_admissions enable row level security;
alter table ward_stays enable row level security;
alter table ot_procedures enable row level security;
alter table ot_images enable row level security;
alter table discharge_records enable row level security;
alter table academic_documents enable row level security;
alter table special_records enable row level security;
alter table register_columns enable row level security;
alter table special_record_versions enable row level security;
alter table department_users enable row level security;
alter table audit_logs enable row level security;
alter table uat_results enable row level security;
alter table hospital_acceptance enable row level security;

insert into storage.buckets (id, name, public)
values ('dops-private', 'dops-private', false)
on conflict (id) do update set public = false;

-- Authentication tables (email OTP). Kept in a separate file so existing
-- deployments can apply it on its own: see supabase/migrations/001_email_otp_auth.sql
