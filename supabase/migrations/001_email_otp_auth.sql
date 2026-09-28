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
