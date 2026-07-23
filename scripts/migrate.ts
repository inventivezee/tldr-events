// Applies raw .sql migrations in src/db/migrations in filename order, tracking
// applied files in a schema_migrations table. Uses the direct (unpooled) URL
// when available so DDL runs in session mode.
import "./_env";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { connectionOptions } from "../src/db/connection";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../src/db/migrations");

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set");

  const sql = postgres(url, { ...connectionOptions(url), max: 1 });
  try {
    await sql`
      create table if not exists schema_migrations (
        filename    text primary key,
        applied_at  timestamptz default now()
      )
    `;
    const applied = new Set(
      (await sql<{ filename: string }[]>`select filename from schema_migrations`).map(
        (r) => r.filename,
      ),
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }
      const ddl = readFileSync(resolve(migrationsDir, file), "utf8");
      console.log(`  apply ${file} …`);
      await sql.begin(async (tx) => {
        await tx.unsafe(ddl);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      ran++;
    }
    console.log(ran === 0 ? "Up to date." : `Applied ${ran} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
