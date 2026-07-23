import { defineConfig } from "drizzle-kit";

// Migrations run against the DIRECT (unpooled) connection when available.
const url =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  // We author the initial extension/DDL as a hand-written SQL migration to stay
  // 1:1 with the PRD §8 schema (citext, arrays, partial fidelity), and use
  // drizzle only for type-safe queries + additive future migrations.
  verbose: true,
  strict: true,
});
