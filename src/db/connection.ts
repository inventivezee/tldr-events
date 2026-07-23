// Shared postgres.js connection options. Works with Supabase (transaction
// pooler :6543 + direct :5432), Neon pooler, and local Postgres.
// `prepare: false` is required for transaction-mode poolers (Supavisor / PgBouncer).
import type { Options } from "postgres";

export function connectionOptions(url: string): Options<Record<string, never>> {
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  const hasSslParam = /[?&]sslmode=/.test(url);
  const opts: Options<Record<string, never>> = { prepare: false };
  // Managed Postgres (Supabase/Neon) requires TLS; honor an explicit sslmode if
  // the URL already carries one, otherwise require SSL for any remote host.
  if (!isLocal && !hasSslParam) {
    opts.ssl = "require";
  }
  return opts;
}
