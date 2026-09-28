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
