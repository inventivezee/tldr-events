-- Lock the tables down to our own connection (Supabase advisory: rls_disabled_in_public).
--
-- Supabase exposes every table in `public` over PostgREST, reachable with the
-- project's `anon` key. That key is designed to be public — it ships in browsers —
-- so it is NOT the security boundary; Row-Level Security is. With RLS off and the
-- default grants in place, anyone holding the project URL and that key could read,
-- edit, or delete everything.
--
-- This app never touches PostgREST: it connects over the Postgres protocol as the
-- `postgres` role using DATABASE_URL, and there is no Supabase SDK or anon key
-- anywhere in the code or the deployment env. So the safe fix is to shut the HTTP
-- door entirely rather than write per-table policies.
--
-- Two layers, both of which leave our connection untouched:
--   1. ENABLE ROW LEVEL SECURITY with NO policies → every PostgREST request sees
--      zero rows and every write is rejected. A table's OWNER bypasses RLS, and
--      these tables are owned by `postgres`, which is exactly who we connect as.
--      FORCE ROW LEVEL SECURITY is deliberately NOT set — that would apply RLS to
--      the owner too and break the pipeline.
--   2. REVOKE the default grants from `anon` and `authenticated`, so the API is
--      denied at the privilege level as well. `service_role` keeps its grants: it
--      is Supabase's admin role, used by the dashboard's table editor.
--
-- To use the Supabase client from a browser later, re-grant the specific
-- privileges needed and add explicit policies for the tables being exposed.

alter table events            enable row level security;
alter table scores            enable row level security;
alter table sources           enable row level security;
alter table feeds             enable row level security;
alter table people            enable row level security;
alter table regions           enable row level security;
alter table job_locks         enable row level security;
alter table digest_posts      enable row level security;
alter table click_events      enable row level security;
alter table schema_migrations enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from anon;
revoke all on all sequences in schema public from authenticated;

-- Stop future tables from being granted to the API roles by default.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on sequences from authenticated;
