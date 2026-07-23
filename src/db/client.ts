// Postgres client + Drizzle instance. Uses postgres.js so it works with any
// Postgres (Neon pooled, Supabase, local). `prepare: false` keeps it compatible
// with transaction-mode poolers (Neon PgBouncer). Job locking uses
// pg_advisory_xact_lock inside a transaction, which is pooler-safe.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "./schema";
import { connectionOptions } from "./connection";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function sqlClient() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _sql = postgres(url, {
    ...connectionOptions(url),
    max: Number(process.env.PG_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return _sql;
}

export function getDb() {
  if (_db) return _db;
  _db = drizzle(sqlClient(), { schema });
  return _db;
}

export { schema };

/**
 * Run `fn` while holding a transaction-scoped advisory lock, so overlapping
 * cron invocations of the same job can't clobber each other. Returns
 * `{ ran: false }` if the lock is already held (another run in flight).
 */
export async function withJobLock<T>(
  lockKey: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const sql = sqlClient();
  return sql.begin(async (tx) => {
    const [{ locked }] = await tx<{ locked: boolean }[]>`
      select pg_try_advisory_xact_lock(${lockKey}) as locked
    `;
    if (!locked) return { ran: false as const };
    const result = await fn();
    return { ran: true as const, result };
  });
}

/** Stable-ish integer lock keys per job type. */
export const LOCK = {
  ingest: 811001,
  dedup: 811002,
  research: 811003,
  score: 811004,
  digest: 811005,
} as const;

export { dsql };
