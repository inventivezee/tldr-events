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
 * Run `fn` under a lease-based lock (job_locks table), so overlapping cron
 * invocations of the same job can't run concurrently — WITHOUT holding a
 * transaction open for the whole job (which would tie up a pooled connection
 * idle-in-transaction across minutes of browser/LLM I/O). The lease auto-expires
 * after `ttlSeconds` so a crashed job doesn't wedge the lock forever.
 * Returns `{ ran: false }` if another run currently holds the lease.
 */
export async function withJobLock<T>(
  name: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const sql = sqlClient();
  // The lease expiry is computed in SQL, not passed as a JS Date.
  //
  // With `prepare: false` postgres.js has to infer parameter types from the JS
  // values, and that inference only held while this was the FIRST query on the
  // connection — once anything else had run, the Date was inferred as text and
  // the bind threw ("Received an instance of Date"). Every cron route happened
  // to take its lock before touching the DB, so the fault stayed hidden until a
  // caller read state first. Passing a plain number sidesteps the inference
  // entirely, and using now() means the lease is timed by the database clock
  // rather than a serverless instance's, so clock skew can't shorten or extend it.
  const acquired = await sql`
    insert into job_locks (name, locked_until, updated_at)
    values (${name}, now() + (${ttlSeconds} * interval '1 second'), now())
    on conflict (name) do update
      set locked_until = now() + (${ttlSeconds} * interval '1 second'), updated_at = now()
      where job_locks.locked_until < now()
    returning name
  `;
  if (acquired.length === 0) return { ran: false as const };
  try {
    const result = await fn();
    return { ran: true as const, result };
  } finally {
    // Release early so the next scheduled run isn't blocked by a stale lease.
    await sql`update job_locks set locked_until = now() where name = ${name}`;
  }
}

/** Lock names + lease TTLs (seconds) per job type. */
export const LOCK = {
  ingest: "ingest",
  dedup: "dedup",
  research: "research",
  score: "score",
  digest: "digest",
} as const;

export const LOCK_TTL: Record<string, number> = {
  ingest: 600,
  dedup: 300,
  research: 600,
  score: 600,
  digest: 180,
};

export { dsql };
