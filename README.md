# TLDR Events

*The best Bay Area events for founders and investors — curated, scored, and summarized. Skip the firehose.*

TLDR Events ingests events from many sources, de-duplicates them, researches **who's in the room**, scores every event against a founder/investor editorial rubric with a top-tier LLM, and delivers a short, ranked shortlist — each with a one-line **TL;DR** — to a public **Telegram** channel/bot and the **web**.

This is the **Phase 1** implementation from the PRD (v5): one feed (`bay_founder`), one region (entire Bay Area), Telegram + Web. Email (Phase 2) and per-reader profiles (Phase 3) are deliberately deferred but the schema/architecture leave room for them with no rewrite.

---

## Stack

- **Next.js 15** (App Router) — public web + API routes + Telegram webhook, all TypeScript.
- **Vercel** — hosting + **Vercel Cron** for the scheduled pipeline. *(Cron at sub-daily frequency requires the **Vercel Pro** plan.)*
- **Supabase Postgres** — the single store (works with any Postgres; `postgres.js`, pooler-safe).
- **Anthropic Claude** — editorial scoring (`claude-opus-4-8`) + speaker-research synthesis (`claude-sonnet-5`).
- **Browserbase** (residential proxies) + `playwright-core` — browser scrapes and Google speaker research, run remotely so nothing headful runs on Vercel.

## Architecture

```
Ingestion (Luma API + browser scrapes incl. Google)
   → Dedup / canonicalize  → Speaker research (people DB)
   → Editorial scoring (per feed, incremental)
   → Delivery: Telegram channel + bot · Public web
```

Everything reads/writes one Postgres store. The pipeline runs as five idempotent, batch-limited, advisory-locked cron endpoints so each stays within a serverless function's time budget and drains its backlog over successive runs.

| Cron endpoint | Schedule (`vercel.json`) | Does |
|---|---|---|
| `/api/cron/ingest` | every 3h | run source adapters → upsert `events` (UTC) |
| `/api/cron/dedup` | every 3h (+12m) | group source rows, pick `is_primary`, enrich |
| `/api/cron/research` | every 30m | research new/stale named people → `people` |
| `/api/cron/score` | every 30m (+15m) | score new/changed primary events per feed |
| `/api/cron/digest` | every 15m | post due digests to Telegram (tz-aware) |

Key source files: `src/ingestion/*`, `src/dedup/canonicalize.ts`, `src/research/speakers.ts`, `src/scoring/*`, `src/digest/*`, `src/telegram/*`, `app/*` (web + API).

---

## Setup

### 1. Accounts & credentials

Fill `.env.local` (already scaffolded; git-ignored). See it for exactly where each value comes from. Minimum to run anything: `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED`) and `LLM_API_KEY`. Full pipeline also needs `BROWSERBASE_*` and `TELEGRAM_*`.

- **Supabase** → click the green **Connect** button at the top of the dashboard → **Connection String**. `DATABASE_URL` = **Transaction pooler** (`:6543`); `DATABASE_URL_UNPOOLED` = **Session pooler** (`:5432`, for migrations). The DB password is embedded in the string (there's no separate password env). *Note: Supabase's publishable/secret API keys are for the client SDK, not this direct Postgres connection — not used here.*
- **Anthropic** → console.anthropic.com → API key → `LLM_API_KEY`.
- **Browserbase** → dashboard → `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`.
- **Telegram** → @BotFather `/newbot` → `TELEGRAM_BOT_TOKEN`. This deployment posts to a **group**: add the bot to your group and promote it to admin (post rights). Set `TELEGRAM_CHANNEL_ID` to the group's numeric chat id (negative, e.g. `-100…`) — run `npm run doctor` after messaging the group to have it printed. `TELEGRAM_ALLOWED_CHAT_IDS` gates admin/test commands (set to your Telegram user id).

Verify everything is wired with a live preflight:
```bash
npm run doctor   # checks DB, LLM, Browserbase, Telegram; lists recent chat ids
```

`TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` are pre-generated in `.env.local`.

### 2. Install, migrate, seed

```bash
npm install
npm run db:migrate     # applies src/db/migrations/*.sql
npm run db:seed        # inserts region + 8 sources + the bay_founder feed
```

### 3. De-risk the scorer (Milestone 0 — do this first)

```bash
npm run eval
```

Scores the labeled set in `src/eval/labeled-set.ts` and prints **top-tier precision**. Replace those illustrative entries with 30–50 **real** Bay Area events labeled from a founder/investor POV, then iterate `src/scoring/rubric.ts` until the Must-Attend tier is trustworthy. Bump `RUBRIC_VERSION` on any rubric change (it triggers a re-score).

### 4. Run the pipeline locally

```bash
npm run pipeline                 # ingest → dedup → research → score
npm run pipeline -- digest:daily # also force a daily digest post (to your test channel)
npm run dev                      # http://localhost:3000
```

`npm run pipeline -- ingest` (etc.) runs a single stage.

---

## Deploy (Vercel)

1. Push this repo to GitHub (done — see below) and **Import** it in Vercel.
2. In **production, Vercel's Environment Variables are the source of truth** — add every value there (Project → Settings → Environment Variables). Set `NEXT_PUBLIC_SITE_URL` to your real domain and `NEXT_PUBLIC_TELEGRAM_URL` to your group's invite link. `.env.local` is only for running scripts on your own machine; to avoid maintaining two copies, set them in Vercel once and run `vercel env pull .env.local` to sync locally when you need `db:migrate`/`db:seed`/`eval`.
3. Ensure the project is on the **Pro plan** (needed for the 15-minute digest cron). `vercel.json` registers the crons automatically; Vercel calls them with the `CRON_SECRET`.
4. Run migrations + seed against the production DB (from your machine with prod `DATABASE_URL`, or a one-off): `npm run db:migrate && npm run db:seed`.
5. Register the Telegram webhook (after the domain is live):
   ```bash
   npm run tg:set-webhook          # uses NEXT_PUBLIC_SITE_URL + TELEGRAM_WEBHOOK_SECRET
   ```
6. **Shadow mode (Milestone 3):** point `TELEGRAM_CHANNEL_ID` at a private test channel for ~2 weeks, review every digest, then switch to the public channel.

You can trigger any job manually (e.g. to smoke-test) with the secret:
```bash
curl "$SITE/api/cron/ingest?secret=$CRON_SECRET"
```

### Hosting: Vercel vs Railway

Both work; the code is portable (plain Next.js + node scripts + scheduler-agnostic cron endpoints protected by `CRON_SECRET`).

- **Vercel (recommended, and what's wired up):** best-in-class for the SEO/ISR web surface, zero-config deploy, built-in Cron. The pipeline is batched, budget-bounded, and lock-guarded to fit serverless function limits. Needs the **Pro** plan for the 15-min cron cadence (well within the $200/mo budget).
- **Railway:** better if you'd rather run the pipeline as one long-lived worker with no function-duration limits (heavy browser scraping), want to avoid Vercel Pro, or host Postgres alongside. You'd run `next start` for the web and either Railway Cron hitting the same `/api/cron/*` endpoints or a small scheduler running the `scripts/run-pipeline.ts` functions. Trade-off: less optimal web/edge hosting and a bit more ops.

Bottom line: **stay on Vercel** unless live runs show the browser scrapes consistently bumping the function time limit — then move the pipeline to a Railway worker (the web can stay on Vercel).

---

## How it honors the PRD

- **UTC everywhere in the store; localize only at display** (`src/lib/time.ts`, IANA via luxon — DST automatic).
- **Relevance is the score, not a category gate** — the scorer's candidate set is *every* primary active event in-region within the window (`src/scoring/scorer.ts`).
- **Who's in the room** — `src/research/speakers.ts` builds a cached `people` DB; scoring feeds researched prominence/notes to the model and the TL;DR names names.
- **Incremental** — only events with no score or a changed `content_hash`/`rubric_version` are (re)scored; people researched once per TTL. `content_hash` ignores cosmetic date-format changes.
- **Fail partial** — one source breaking never fails the digest; Luma (backbone) is ordered first.
- **Quality is profile-agnostic** — `scores.score` is quality only, so Phase 3 fit re-ranking layers on without re-scoring.

## Known things to validate/tune against live data

Validated live (2026-07): **Luma ~210, Eventbrite ~107, Cerebral Valley ~135, Partiful ~44** events per run; dedup, speaker research (Browserbase + LLM), and Opus scoring all run end-to-end. Remaining caveats:

- **Google requires residential proxies to be ENABLED on your Browserbase project.** With a datacenter exit IP, Google serves its `/sorry` "unusual traffic" bot wall and the adapter returns 0 (it detects this and logs a clear warning). Enable residential proxies in Browserbase, or treat Google as an optional supplement — the other four sources give strong coverage, and the PRD's documented alternative is the Meetup GraphQL API (`MEETUP_API_TOKEN`). Google also heavily overlaps the other sources (resolved by dedup).
- **Scraper selectors** (Cerebral Valley, Eventbrite, Partiful) work today but DOMs drift; each adapter logs a `SCHEMA DRIFT?` warning when a page has content but nothing parses, so drift is visible.
- **Luma endpoints** default to `https://api.lu.ma`; override with `LUMA_API_BASE` if the host/shape changes.
- **Ingest duration**: batched upserts + backbone-first ordering keep runs fast; the pipeline is split into `/api/cron/ingest` (core) and `/api/cron/ingest-extra` (Partiful/Google) so neither starves the other.

## Tests / typecheck

```bash
npm test          # deterministic core: time, dedup matching, hashing, rendering, Luma parse
npm run typecheck # tsc --noEmit
npm run build     # Next.js production build
```

## Roadmap (deferred, non-breaking)

- **Phase 2 — Email** (Appendix D): adds `subscribers/subscriptions/deliveries/email_events` + a Resend dispatch worker. No changes to Phase 1 tables.
- **Phase 3 — Personalization** (§15): adds a `profiles` table + a fit re-rank at read time. `scores.score` is already profile-agnostic quality.
