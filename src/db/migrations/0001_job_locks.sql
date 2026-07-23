-- Lease-based job lock (replaces holding a long transaction open across minutes
-- of browser/LLM I/O). Each cron job acquires a time-limited lease; a crashed job
-- auto-expires. Pooler-safe: acquire/release are single quick statements.
create table if not exists job_locks (
  name         text primary key,
  locked_until timestamptz not null,
  updated_at   timestamptz default now()
);
