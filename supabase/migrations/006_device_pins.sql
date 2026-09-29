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
