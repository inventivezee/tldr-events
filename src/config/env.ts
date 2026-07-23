// Server-only environment access. Validated lazily so the web build doesn't
// fail when optional pipeline secrets are absent in a given deploy target.
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),

  LLM_PROVIDER: z.enum(["anthropic", "openai", "google"]).default("anthropic"),
  LLM_API_KEY: z.string().optional(),
  SCORING_MODEL: z.string().default("claude-opus-4-8"),
  RESEARCH_MODEL: z.string().default("claude-sonnet-5"),

  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),

  CRON_SECRET: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().default("http://localhost:3000"),

  MEETUP_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when a secret is present and non-empty. */
export function has(key: keyof Env): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

/** Parsed allowlist of admin/test chat ids (numbers). */
export function allowedChatIds(): number[] {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}
