// Speaker & host research → the `people` profile database (PRD §11.3, Appendix A).
// Resolves named speakers/hosts on primary upcoming events, researches each new/
// stale person once via Google + Browserbase, synthesizes a structured profile
// with the LLM, and caches it. Incremental + batch-limited (cron-duration safe).
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { PersonRef, PersonProfile, ResearchSource } from "@/types";
import {
  createBrowserSession,
  browserConfigured,
  sleep,
  type BrowserSession,
} from "@/lib/browserbase";
import { resolveModel, llmConfigured, structuredCall, type ToolDef } from "@/lib/llm";
import { normalizeName } from "@/lib/text";
import { forwardWindow } from "@/lib/time";
import { logger } from "@/lib/logger";

const log = logger("research");
const DEFAULT_BATCH = 20;

interface Candidate {
  name: string;
  nameNormalized: string;
  context: string;
}

export interface ResearchSummary {
  skipped?: string;
  candidates: number;
  researched: number;
  cached: number;
}

const PERSON_TOOL: ToolDef = {
  name: "record_person_profile",
  description:
    "Record a synthesized professional profile for the named person, based ONLY on the provided search results. If the results do not clearly identify a specific, real professional, set found=false and prominence low.",
  input_schema: {
    type: "object",
    properties: {
      found: {
        type: "boolean",
        description: "True only if the results clearly identify a specific real person.",
      },
      display_name: { type: "string" },
      title: { type: "string", description: "Current role, e.g. 'Partner', 'Co-founder & CEO'." },
      company: { type: "string", description: "Current primary org/fund/company." },
      affiliations: {
        type: "array",
        items: { type: "string" },
        description: "Other/past notable orgs, funds, or companies.",
      },
      links: {
        type: "object",
        properties: {
          linkedin: { type: "string" },
          crunchbase: { type: "string" },
          twitter: { type: "string" },
          website: { type: "string" },
        },
      },
      bio: { type: "string", description: "1–2 sentence synthesized bio." },
      prominence: {
        type: "number",
        description:
          "0–10 signal of how notable this person is to a founder/investor audience (top-fund partner, exited founder, leading researcher = high; unknown = low).",
      },
      note: {
        type: "string",
        description: "One-line why-notable, e.g. 'Partner at Sequoia Capital'.",
      },
    },
    required: ["found", "display_name", "prominence", "note"],
  },
};

export async function runResearch(opts?: {
  batch?: number;
}): Promise<ResearchSummary> {
  if (!browserConfigured())
    return { skipped: "browserbase not configured", candidates: 0, researched: 0, cached: 0 };
  if (!llmConfigured())
    return { skipped: "llm not configured", candidates: 0, researched: 0, cached: 0 };

  const db = getDb();
  const batch = opts?.batch ?? Number(process.env.RESEARCH_BATCH ?? DEFAULT_BATCH);

  const candidates = await collectCandidates();
  const toResearch: Candidate[] = [];
  let cached = 0;

  for (const c of candidates) {
    const [existing] = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.nameNormalized, c.nameNormalized))
      .limit(1);
    if (existing && isFresh(existing.researchedAt, existing.ttlDays ?? 180)) {
      cached++;
      continue;
    }
    toResearch.push(c);
    if (toResearch.length >= batch) break;
  }

  if (toResearch.length === 0) {
    log.info(`research: nothing to do (${candidates.length} candidates, ${cached} fresh)`);
    return { candidates: candidates.length, researched: 0, cached };
  }

  let session: BrowserSession | undefined;
  let researched = 0;
  try {
    session = await createBrowserSession();
    for (const c of toResearch) {
      try {
        const { profile, query, sources } = await researchPerson(session, c);
        await upsertPerson(c, profile, query, sources);
        researched++;
      } catch (e) {
        log.warn(`failed to research "${c.name}"`, e);
      }
      await sleep(2000);
    }
  } finally {
    if (session) await session.close();
  }

  log.info(
    `research: ${researched} researched, ${cached} cached (${candidates.length} candidates)`,
  );
  return { candidates: candidates.length, researched, cached };
}

/** Distinct named people from primary, active, upcoming events + a context hint. */
async function collectCandidates(): Promise<Candidate[]> {
  const db = getDb();
  const now = new Date();
  const { start, end } = forwardWindow(now, "America/Los_Angeles", 30);

  const rows = await db
    .select({
      title: schema.events.title,
      hosts: schema.events.hosts,
      speakers: schema.events.speakers,
      venueName: schema.events.venueName,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isPrimary, true),
        eq(schema.events.status, "active"),
        gte(schema.events.startsAt, start),
        lte(schema.events.startsAt, end),
      ),
    );

  const map = new Map<string, Candidate>();
  const add = (ref: PersonRef, ctx: string) => {
    if (!plausiblePerson(ref?.name)) return;
    const key = normalizeName(ref.name);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, { name: ref.name.trim(), nameNormalized: key, context: ctx });
    }
  };
  for (const r of rows) {
    const hosts = (r.hosts ?? []) as PersonRef[];
    const speakers = (r.speakers ?? []) as PersonRef[];
    const hostNames = hosts.map((h) => h.name).filter(Boolean).join(", ");
    const ctx = `Event: "${r.title}". Hosts: ${hostNames || "n/a"}.`;
    for (const h of hosts) add(h, ctx);
    for (const s of speakers) add(s, s.bio ? `${ctx} Bio hint: ${s.bio}` : ctx);
  }
  return [...map.values()];
}

/** Filter out non-people / generic labels before spending a lookup. */
function plausiblePerson(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  const tokens = n.split(/\s+/);
  if (tokens.length < 2) return false; // require at least first + last
  if (/team|group|club|community|inc\.?$|llc|the |committee|organizers?/i.test(n))
    return false;
  if (!/[a-zA-Z]/.test(n)) return false;
  return true;
}

function isFresh(researchedAt: Date | null, ttlDays: number): boolean {
  if (!researchedAt) return false;
  const ageDays = (Date.now() - researchedAt.getTime()) / 86400000;
  return ageDays < ttlDays;
}

async function researchPerson(
  session: BrowserSession,
  c: Candidate,
): Promise<{ profile: PersonProfile & { found?: boolean }; query: string; sources: ResearchSource[] }> {
  const query = `"${c.name}" founder OR investor OR partner OR CEO`.trim();
  const captured = await googleCapture(session, query);

  // If results are thin, one LinkedIn-targeted follow-up (Appendix A).
  if (captured.results.length < 2) {
    const follow = await googleCapture(session, `${c.name} LinkedIn`);
    captured.results.push(...follow.results);
    captured.panel = captured.panel || follow.panel;
  }

  const sourcesText = [
    captured.panel ? `KNOWLEDGE PANEL:\n${captured.panel}` : "",
    ...captured.results.map(
      (r, i) => `RESULT ${i + 1}: ${r.title}\n${r.url}\n${r.snippet}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);

  const profile = await structuredCall<PersonProfile & { found?: boolean }>({
    model: resolveModel(null, process.env.RESEARCH_MODEL, "research"),
    system:
      "You synthesize concise professional profiles for a founder/investor events product. Judge notability from the reader's perspective. Use ONLY the provided search text; never invent facts. Be conservative with prominence.",
    user: `Person: ${c.name}\nContext: ${c.context}\n\nGoogle search text follows. Synthesize their profile.\n\n${sourcesText || "(no results captured)"}`,
    tool: PERSON_TOOL,
    maxTokens: 700,
  });

  const sources: ResearchSource[] = captured.results.map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.snippet,
  }));
  return { profile, query, sources };
}

interface Captured {
  panel: string;
  results: Array<{ title: string; url: string; snippet: string }>;
}

async function googleCapture(session: BrowserSession, query: string): Promise<Captured> {
  const { page, goto } = session;
  await goto(
    `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`,
    { waitMs: 1200 },
  );
  await sleep(800);
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) =>
      (s || "").replace(/\s+/g, " ").trim();
    // Knowledge panel (right-hand side / kp block).
    const panelEl =
      document.querySelector("#rhs") ||
      document.querySelector("[data-attrid='kc:/common']") ||
      document.querySelector(".kp-wholepage");
    const panel = clean(panelEl?.textContent).slice(0, 1500);

    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const anchors = Array.from(document.querySelectorAll("a[href^='http'] h3"));
    for (const h3 of anchors.slice(0, 6)) {
      const a = h3.closest("a") as HTMLAnchorElement | null;
      if (!a) continue;
      const block = a.closest("div[data-hveid], div.g") || a.parentElement;
      const snippet = clean(block?.textContent).slice(0, 300);
      results.push({ title: clean(h3.textContent), url: a.href, snippet });
    }
    return { panel, results };
  });
}

async function upsertPerson(
  c: Candidate,
  profile: PersonProfile & { found?: boolean },
  query: string,
  sources: ResearchSource[],
): Promise<void> {
  const db = getDb();
  const links = { ...(profile.links ?? {}) };
  // Backfill links from captured result URLs if the model missed them.
  for (const s of sources) {
    if (!s.url) continue;
    if (!links.linkedin && /linkedin\.com\/in\//i.test(s.url)) links.linkedin = s.url;
    if (!links.crunchbase && /crunchbase\.com\/person\//i.test(s.url))
      links.crunchbase = s.url;
    if (!links.twitter && /(twitter|x)\.com\//i.test(s.url)) links.twitter = s.url;
  }

  const prominence = clamp(profile.found === false ? Math.min(profile.prominence ?? 0, 2) : profile.prominence ?? 0, 0, 10);

  const values = {
    nameNormalized: c.nameNormalized,
    displayName: profile.display_name || c.name,
    title: profile.title ?? null,
    company: profile.company ?? null,
    affiliations: profile.affiliations ?? [],
    links,
    bio: profile.bio ?? null,
    prominence: prominence.toFixed(1),
    note: profile.note ?? null,
    researchQuery: query,
    researchSources: sources,
    researchedAt: new Date(),
    ttlDays: 180,
  };

  await db
    .insert(schema.people)
    .values(values)
    .onConflictDoUpdate({
      target: schema.people.nameNormalized,
      set: values,
    });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Resolve profiles for a set of names (used by the scorer). */
export async function resolvePeople(
  names: string[],
): Promise<Map<string, typeof schema.people.$inferSelect>> {
  const db = getDb();
  const keys = [...new Set(names.map(normalizeName).filter(Boolean))];
  const out = new Map<string, typeof schema.people.$inferSelect>();
  if (keys.length === 0) return out;
  const rows = await db
    .select()
    .from(schema.people)
    .where(inArray(schema.people.nameNormalized, keys));
  for (const row of rows) out.set(row.nameNormalized, row);
  return out;
}
