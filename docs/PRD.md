# TLDR Events
### Product Requirements Document — v6

*The best events for founders and investors — curated, scored, and summarized. Skip the firehose.*

**Updated August 2026**

---

## 0. Implementation status (v6 — as built)

Phase 1 is **built, deployed and running daily**. This section is the authority where it
disagrees with the original v5 spec below; the later sections have been updated in place
where the delta is structural.

### Stack & hosting
- **One all-TypeScript Next.js (App Router) app** — web, Telegram webhook, read APIs and the
  whole ingestion→dedup→research→scoring pipeline (as protected cron endpoints). No separate
  Python service.
- **Vercel** (git-connected auto-deploy) + **Supabase Postgres** via the Supavisor transaction
  pooler — direct Postgres with `postgres.js`, not the Supabase client SDK.
- **Browserbase** (residential proxies always on) + `playwright-core` for browser sources.
- Custom domain **tldrevents.com** (apex serves; `www` redirects).

### What changed most from v5
- **Scoring weights speakers far above hosts.** v5 treated "who's in the room" as the dominant
  signal; in practice attendee lists are rarely public and organisers appear on every listing,
  so weighting the room inflated ordinary meetups and buried strong events with unlisted rooms.
  The rubric (v6) now drives the score from relevance, format, topic and apparent quality, with
  a **billed speaker** as a strong bonus and the **organiser** a mild one. An unknown room never
  caps or lowers a score. See §11.2.
- **Model provider is configurable.** Claude by default; any OpenAI-compatible host (DeepSeek,
  Qwen, OpenRouter, Together, Groq, self-hosted) via `LLM_PROVIDER`. See §17.
- **One cron, not six.** Vercel dropped scheduled ticks in two distinct ways, so the pipeline is
  a single job that advances one stage per tick. See §16.
- **Telegram is one compact message**, no inline buttons, direct source links, no per-event
  summary. See §12.
- **The web board gained a calendar, per-day pages and a 6.5 visible floor.** See §13.
- **SEO/answer-engine surface** — schema.org Event markup, canonical URLs, `llms.txt`. See §13.1.

### Live shape (August 2026)
- ~370 primary events in the 21-day scoring window; ~11 sources.
- Tiers: 🔥 **Must Attend** (8–10), ⭐ **Strong Pick** (6–7.9), 👀 **Worth a Look** (<6).
- Telegram: public **group** `@sfbayareaevents` (a group, not a channel — functionally identical
  for posting), daily digest 17:30 PT covering **tomorrow**, weekly Sunday 18:00 PT.

Where the sections below say "channel," read "channel or group"; where they say "Don't Miss,"
read "Must Attend."

---

## 1. Overview

TLDR Events is a curated, **public** event digest. It ingests events from many sources, removes duplicates, scores every event against a niche-specific editorial standard — weighing **who's in the room** as much as the topic — and delivers a short, ranked shortlist, each event with a one-line **TL;DR** explaining why it matters.

The product does the reading so its readers don't have to. Instead of ten open tabs across Luma, Eventbrite, Partiful, and a dozen calendars, it delivers the handful of events actually worth the time — on a **public Telegram channel** and the **web** at launch, with email following in Phase 2.

It is opinionated for **founders and investors**. It optimizes for events that build companies and relationships — demo days, founder dinners, pitch nights, investor/LP gatherings, high-signal talks, and hackathons (a prime place to meet a co-founder) — and de-emphasizes passive, beginner, or purely educational content. It launches with a single feed spanning **three niches — AI, Longevity, and fintech/blockchain** — covering the **entire Bay Area as one region**, and is built so additional niches, regions, and eventually **per-reader profile ranking** are added as configuration, not new code.

---

## 2. Problem & Opportunity

**The problem.** Event discovery is a firehose. The events a founder or investor actually wants — an intimate founder dinner, a demo night from a company that matters, a room with the right operators and investors — are buried among hundreds of generic paid courses, social mixers, and virtual webinars, spread across platforms that don't talk to each other. Listing tools (Luma, Eventbrite) show *everything*; none of them tell you *what's worth your time in your world*.

**The insight.** The scarce thing is not the list — it's the judgment. Value comes from curation applied *for a specific reader* and *for the right room*: knowing that a 700-RSVP launch is a big deal, that a dinner with two notable fund partners is worth crossing town for, and that most anonymous "networking mixers" are noise. Two readers with different goals — someone hunting for a co-founder vs. an investor sourcing deals — want the same events ranked differently.

**The opportunity.** A product that owns the curation layer — one editorial standard per niche, applied consistently, informed by who's attending and speaking, and summarized in a line — becomes the default filter people trust and follow. Curation is defensible in a way a raw aggregator is not; per-reader personalization compounds that moat.

### Competitive Landscape

| Alternative | What it offers | Where it falls short |
|-------------|----------------|----------------------|
| **Luma Discover** | The richest Bay Area tech inventory; good host following | A listing, not a filter — shows everything, applies no judgment. (Also an ingestion *source* for us.) |
| **Cerebral Valley newsletter** | Strong human editorial voice for AI-insider events | One person's manual picks, fixed cadence, AI-only, SF-centric; doesn't scale across niches or regions. (Also a source.) |
| **Eventbrite / Meetup discovery** | Huge inventory, official APIs | Firehose sorted by SEO and ad spend; skews to generic paid courses; no taste layer. |
| **SF tech newsletters & curated lists** | Human curation with real taste | Single curator's fixed beat; no per-niche scoring, no personalization, coverage caps at what one person reads. |

**The differentiator in one sentence:** TLDR Events is the only layer that combines cross-source aggregation with dedup, per-niche editorial scoring informed by researched attendee/speaker quality, and a one-line TL;DR for every event — judgment expressed as data, repeatable across any niche or city, and ultimately re-rankable per reader.

---

## 3. Users & Personas

### Reader — primary (public)
A **founder or investor** operating across AI, Longevity, and fintech/blockchain. Wants signal density (no filler), correct event times **in their own timezone**, a one-line reason each event made the cut, and zero friction. Cares about who's in the room as much as the topic. Consumes via the public **Telegram channel** (scheduled digest) + an **on-demand bot**, and the **public web** browse pages; email arrives in Phase 2. The founder building this is reader #1 and the initial curator, and shares it with others from launch.

### Curator — internal
Owns a feed's editorial standard: its scoring rubric, quality bar, and the tone of its TL;DR lines. This role is what lets curation quality scale as niches are added — every feed has a human accountable for "is this shortlist actually good?"

### Reader profiles — Phase 3
The same events, re-ranked for a reader's goals: **seeking a co-founder** (you, now), **existing founder**, **investor** (you, now), **looking to join a startup**, and so on. A profile shifts the ranking (a co-founder-seeker sees hackathons and builder dinners boosted; an investor sees demo days and LP gatherings boosted) and readers can also choose which event types they like. Architecture in §15.

---

## 4. Product Principles

1. **Curation is the product.** Every delivered event carries a score, a tier, and a one-line TL;DR. The shortlist and the "why" are the value — not the raw feed.
2. **Rank on who's there, not just what it's about.** Attendee count, attendee quality, and speaker quality are first-class ranking signals — the system actively researches the notability of named speakers and hosts.
3. **Quality is shared; fit is personal.** The base score measures event quality and is the same for everyone; per-reader *fit* (Phase 3) re-ranks that quality for a specific profile and preferences. This split keeps scoring cheap and personalization additive.
4. **A niche is data, not code.** A *feed* = a region + qualifying categories + a source set + an editorial rubric. Launching a new niche, reader profile, or city is a configuration change.
5. **One store, many surfaces.** Ingestion and scoring feed a single database. Telegram, web, and (later) email are thin read surfaces. No surface owns state.
6. **Times are UTC in the store, localized only at display.** Regions and readers each have a timezone; all conversion uses IANA timezone data so daylight-saving is automatic. No fixed UTC offsets anywhere.
7. **Isolate every source behind an adapter.** Whether an official API or a browser scrape (Google included), each source is independently swappable and monitored for schema drift, so one platform's change never cascades. Scraped sources run through Browserbase with residential proxies.
8. **Fail partial, never total.** If one source breaks, every other source still produces a useful digest.
9. **Ingest wide, score everything, deliver few.** Every source is ingested and every primary event *in the region* is scored; the surfaces show only what clears the bar. Relevance is enforced by the *score*, not by a category gate — so recall is governed by the smart scorer, not by keyword tagging.

---

## 5. Scope & Phasing

| Phase | Scope | Surfaces | Niches |
|-------|-------|----------|--------|
| **1 — Launch (public)** | Entire Bay Area, founder/investor lens (one feed, one region); public Telegram channel + bot; public web (this week / next week, SEO, "Follow" CTA); attendee/speaker-quality scoring incl. speaker research | Telegram · Web | 1 (`bay_founder`) |
| **2 — Email & Expand** | Email digest (double opt-in, Resend — Appendix D); add 2–4 niches and/or a second region; self-serve niche & frequency | + Email · hosted preferences | 2–4 |
| **3 — Personalize** | Reader **profiles** (co-founder-seeker, founder, investor, joiner…) re-ranking events; user event-type preferences; accounts | + accounts, per-profile ranking | Many |

**The one non-negotiable from day one:** every event lands in the store tagged with **region** and **categories**, and its base score reflects **quality** only (profile-agnostic), so per-reader ranking can be layered on later without re-scoring. Everything else can be deferred; these cannot, or expansion becomes a rewrite.

**Monetization (later):** the free public digest builds the audience; natural future paths include a premium tier (more niches, earlier sends, personalization), tasteful clearly-labeled sponsored placements, and B2B feeds for teams. Deferred so it never compromises curation trust early.

### Budget (Phase 1: up to $200/month)

Quality of scoring is the product, so the budget prioritizes the strongest scoring model and the speaker research that feeds it over cost savings.

| Item | Est. monthly |
|------|--------------|
| LLM editorial scoring (top-tier frontier model, incremental only) | ~$20–60 |
| Speaker/host research (model synthesis over Google results, cached per person) | ~$5–20 |
| Browserbase + residential proxies (event scrapes + speaker-research lookups) | ~$40–90 |
| Managed Postgres (Neon / Supabase) | $0–19 |
| Always-on host (bot webhook + digest poster + jobs) | ~$5–20 |
| Domain | ~$1 |
| **Total** | **~$70–190 — fits under the cap** |

The two caches — the `people` speaker database and incremental scoring — are the cost levers: research and scoring scale with *distinct new people and events*, not with fetch frequency or audience size. Speaker-research browser cost is front-loaded — the back-catalog of people is researched once, then steady-state is low.

---

## 6. Success Metrics & Non-Goals

### Success Metrics (public from launch)
- **Curation quality:** precision of the top tier — of events flagged "Don't Miss," what share are genuinely worth attending — sampled against a labeled evaluation set, then audience feedback.
- **Engagement:** Telegram inline-button click-through per digest post (callbacks logged per event); web outbound click-through to event pages; clicks per digest.
- **Growth & retention:** Telegram channel member growth and week-4 retention of active viewers; weekly returning web visitors.
- **North star:** *weekly active viewers who click into ≥1 event.* Directly measurable on both surfaces (Telegram button callbacks + web outbound clicks).

At launch the audience is small (the founder plus early shares); these are the right *shape* of metric to watch grow, with curation quality as the leading indicator.

### Non-Goals (Phase 1)
Ticketing, RSVP, payments, calendar sync, user-submitted events, a mobile app, sub-minute freshness, email subscriptions (Phase 2), per-reader profiles (Phase 3), and sub-region splitting. TLDR Events aggregates and curates; it does not transact.

---

## 7. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         INGESTION                             │
│   Source adapters (Luma API + browser scrapes incl. Google)   │
│          run on schedule → normalize (UTC) → upsert           │
└───────────────────────────────┬───────────────────────────────┘
                                 ▼
                    ┌───────────────────────┐
                    │        STORE           │
                    │   (Postgres)           │
                    │  regions · sources     │
                    │  events · feeds        │
                    │  people · scores       │
                    └───────────┬───────────┘
        ┌─────────────┬─────────┴──┬───────────────┬───────────────┐
        ▼             ▼            ▼               ▼               ▼
 ┌────────────┐ ┌──────────┐ ┌──────────┐  ┌───────────┐   ┌──────────────┐
 │  DEDUP +    │ │ SPEAKER  │ │  SCORER  │  │  DIGEST   │   │  Read APIs    │
 │ CANONICALIZE│→│ RESEARCH │→│per(event,│  │  POSTER   │   │  (web / bot)  │
 │            │ │ Google + │ │  feed)   │  │ (Telegram)│   └──────┬────────┘
 │            │ │Browserbase│ │          │  └─────┬─────┘          ▼
 └────────────┘ │→ people  │ └──────────┘        ▼          ┌──────────────┐
                └──────────┘             ┌──────────────┐   │  Web (Next)  │
                                         │ Telegram     │   └──────────────┘
                                         │ channel+bot  │
                                         └──────────────┘
   (Phase 2: Dispatch worker → Email via Resend) · (Phase 3: per-profile re-rank on read)
```

### Services
| Service | Responsibility |
|---------|----------------|
| **Ingestion workers** | Per-source adapters. Fetch, normalize to UTC, upsert into `events` keyed by `(source_id, source_event_id)`. Failure isolated per source. |
| **Dedup / canonicalizer** | Group source rows describing the same real event; mark one `is_primary`; enrich it. |
| **Speaker research** | Resolve named speakers/hosts, research prominence via Google + Browserbase, cache in the `people` database; reused across events. |
| **Scorer** | Per enabled feed, score **every primary event in the region** against the feed's rubric, using researched people signals (only new/changed events re-score); write the profile-agnostic quality `scores`. |
| **Digest poster** | Every ~15 min: check per-feed post schedules, build the ranked digest, post to the public Telegram channel, log posts. Timezone-aware. |
| **Read surfaces** | Public web (Next.js) and the Telegram bot query the store for browse and on-demand views. (Phase 3: apply per-profile fit re-rank here.) |

### Recommended runtime
- **Store:** managed Postgres (Neon or Supabase; AWS RDS equally fine).
- **Workers + bot + API:** one small always-on host (Railway / Render / Fly / a small VPS).
- **Browser automation:** Browserbase with residential proxies — used for event scrapes (incl. Google) and speaker research.
- **Search (events long-tail + speaker research):** Google via Browserbase. Optional future supplement: official Meetup GraphQL API. See §9.3.
- **Scoring model:** a top-tier frontier model — scoring quality is the product differentiator and the budget (§5) is sized for it. Model choice is per-feed config, not code.
- **Web:** Next.js (SSG/ISR-friendly for public, SEO-indexed browse pages).
- **Email (Phase 2):** Resend (verified sending domain required before real sends).

---

## 8. Data Model (Postgres)

> Requires extensions: `citext`, `pgcrypto`. `gen_random_uuid()` is core in PG 13+.
> Events (including raw payloads) and researched people are **retained indefinitely** — storage is cheap and history powers rubric evaluation, dedup tuning, and the people database.

```sql
create extension if not exists citext;
create extension if not exists pgcrypto;

-- Regions: timezone lives here → every surface localizes correctly.
create table regions (
  id        text primary key,          -- 'sf_bay', 'nyc', 'london'
  name      text not null,
  timezone  text not null              -- IANA, e.g. 'America/Los_Angeles'
);

-- Sources: the scrapers / APIs. Config-driven where possible.
create table sources (
  id         text primary key,
  name       text not null,
  kind       text not null,            -- 'api'|'luma_discover'|'luma_calendar'|'browser'
  region_id  text references regions(id),
  config     jsonb not null,           -- {place_id}|{cal_id}|{url}|{urls}|{queries}
  priority   int default 100,          -- lower = more authoritative for enrichment
  enabled    boolean default true
);

-- People: the speaker/host PROFILE DATABASE. Each named person is researched once
-- (Google via Browserbase, §11.3) and reused across events → attendee/speaker quality.
create table people (
  id              uuid primary key default gen_random_uuid(),
  name_normalized text unique not null,       -- dedup key
  display_name    text,
  title           text,                        -- researched role, e.g. 'Partner'
  company         text,                        -- e.g. 'Sequoia Capital'
  affiliations    jsonb default '[]',           -- other/past orgs, funds, companies
  links           jsonb default '{}',           -- {linkedin, crunchbase, twitter, website}
  bio             text,                         -- short synthesized bio
  prominence      numeric(3,1),                 -- researched signal 0–10
  note            text,                         -- one-line why-notable (feeds TL;DR/score)
  research_query  text,                         -- the Google query used
  research_sources jsonb,                       -- SERP / knowledge-panel / profile snippets captured
  researched_at   timestamptz,
  ttl_days        int default 180               -- re-research after this
);
create index on people (prominence);

-- Events: source-level rows, upserted. UTC timestamps only.
create table events (
  id                uuid primary key default gen_random_uuid(),
  source_id         text references sources(id),
  source_event_id   text not null,      -- stable platform id → robust dedup, no title keying
  title             text not null,
  title_normalized  text not null,
  description       text,
  url               text,
  status            text default 'active',  -- 'active'|'canceled'|'postponed'
  starts_at         timestamptz not null,  -- ALWAYS UTC
  ends_at           timestamptz,
  region_id         text references regions(id),
  venue_name        text,
  venue_normalized  text,
  address           text,
  city              text,
  lat               double precision,
  lng               double precision,
  hosts             jsonb default '[]',    -- [{name, person_id?}]
  speakers          jsonb default '[]',    -- [{name, bio, person_id?}]
  guest_count       int,
  categories        text[] default '{}',   -- 'ai'|'longevity'|'fintech_blockchain'|'founder_investor'|'hackathon'
  canonical_key     text,                  -- deterministic cross-source group key (see §10)
  canonical_group   uuid,                  -- shared id for one logical event across sources
  is_primary        boolean default true,  -- the enriched row within a canonical group
  content_hash      text,                  -- change detection (drives incremental scoring)
  raw               jsonb,                 -- original payload (retained indefinitely)
  first_seen_at     timestamptz default now(),
  last_seen_at      timestamptz default now(),
  unique (source_id, source_event_id)
);
create index on events (starts_at);
create index on events (region_id, starts_at);
create index on events (canonical_key);
create index on events (canonical_group);
create index on events (status);

-- Feeds: the product primitive (niche × region × reader-lens).
create table feeds (
  id             text primary key,       -- 'bay_founder'
  name           text not null,          -- 'Bay Area — Founders & Investors'
  region_id      text references regions(id),
  categories     text[] not null,        -- niches covered (display/eligibility, NOT a hard delivery gate)
  source_ids     text[] not null,        -- which sources feed it
  scoring_rubric text not null,          -- editorial rubric/prompt for THIS feed
  rubric_version int default 1,
  model          text,                   -- scorer model for THIS feed (top-tier at launch)
  min_score      numeric(3,1) default 6.0,  -- delivery threshold (tunable without a deploy)
  curator        text,                   -- owner accountable for quality
  post_schedule  jsonb,                  -- Telegram cadence, e.g. {"daily_hour":7,"weekly_dow":7,"weekly_hour":18}
  telegram_channel_id text,              -- public channel the digest posts to
  enabled        boolean default true
);

-- Scores: per primary event, per feed. QUALITY only (profile-agnostic). `tldr` = one-line why.
create table scores (
  event_id       uuid references events(id) on delete cascade,
  feed_id        text references feeds(id) on delete cascade,
  score          numeric(3,1) not null,  -- 0.0–10.0 QUALITY score (attendees, speakers, signal)
  tier           text not null,          -- 'dont_miss'|'strong'|'radar'
  category_tag   text,                   -- model-assigned niche for display
  tldr           text,                   -- the TL;DR line shown to readers
  signals        jsonb,                  -- breakdown: {attendee_count, attendee_quality, speaker_quality, ...}
  model          text,
  rubric_version int,
  content_hash   text,                   -- event hash scored against → incremental re-score
  scored_at      timestamptz default now(),
  primary key (event_id, feed_id)
);
create index on scores (feed_id, score);

-- Digest posts: audit of scheduled Telegram channel posts.
create table digest_posts (
  id            uuid primary key default gen_random_uuid(),
  feed_id       text references feeds(id),
  kind          text,                    -- 'daily'|'weekly'
  posted_at     timestamptz default now(),
  window_start  timestamptz,
  window_end    timestamptz,
  event_ids     uuid[],
  tg_message_ids int[],
  status        text                     -- 'sent'|'failed'
);

-- Click events: Telegram inline-button callbacks + web outbound clicks → engagement metric.
create table click_events (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references events(id),
  feed_id    text,
  surface    text,                       -- 'telegram'|'web'
  clicked_at timestamptz default now()
);
```

**Why this shape**
- `(source_id, source_event_id)` is a stable upsert key — re-fetches update in place, provenance preserved.
- `people` is a persistent profile database: each speaker/host researched once and reused; `events.speakers[]` / `hosts[]` link to `person_id`.
- `scores.score` is deliberately the **quality** score (profile-agnostic). Per-reader *fit* re-ranking (§15) multiplies it later — no re-scoring needed.
- `scores.signals` records the quality breakdown (attendee count/quality, speaker quality) for transparency and for the Phase 3 fit layer.
- `status` drives lifecycle; all read surfaces filter to `status='active'`.
- `feeds.categories` is for display/eligibility, but delivery filters on `min_score` (§11.5), so a great event with no clean tag is never silently dropped.

### Phase 2 / Phase 3 schema (deferred)
Email (Appendix D) adds four tables — `subscribers`, `subscriptions`, `deliveries`, `email_events`. Personalization (§15) adds a `profiles` table plus a `profile_id`/`preferences` on the reader and an optional `fit_scores` cache. All are pure additions; none change Phase 1 tables.

### Launch seed — region, sources, and the founder/investor feed
The launch feed covers the **entire Bay Area as one region**, three niches under a founder/investor lens (hackathons included), fed by **8 sources across 5 fetch operations**. Eventbrite searches span multiple Bay Area cities. Each source is an explicit row with a `priority` used by dedup enrichment.

```sql
insert into regions (id, name, timezone) values
  ('sf_bay', 'SF Bay Area', 'America/Los_Angeles');

insert into sources (id, name, kind, region_id, priority, config) values
  ('luma_sf_discover',       'Luma — SF Discover',     'luma_discover', 'sf_bay', 10,
     '{"place_id":"discplace-BDj7GNbGlsF7Cka"}'),
  ('luma_founders_club',     'Bay Area Founders Club', 'luma_calendar', 'sf_bay', 20,
     '{"cal_id":"cal-GjoRQb3KjJWJmwa"}'),
  ('luma_founders_bay',      'Founders Bay',           'luma_calendar', 'sf_bay', 20,
     '{"cal_id":"cal-jVCYJFvH7OA4SLT"}'),
  ('luma_frontier_tower',    'Frontier Tower',         'luma_calendar', 'sf_bay', 20,
     '{"cal_id":"cal-Sl7q1nHTRXQzjP2"}'),
  ('cerebral_valley',        'Cerebral Valley',        'browser',       'sf_bay', 30,
     '{"url":"https://cerebralvalley.ai/events?locations=BAY_AREA"}'),
  ('eventbrite_bay',         'Eventbrite (Bay Area)',  'browser',       'sf_bay', 40,
     '{"urls":[
        "https://www.eventbrite.com/d/ca--san-francisco/ai-startup/",
        "https://www.eventbrite.com/d/ca--san-francisco/fintech/",
        "https://www.eventbrite.com/d/ca--san-francisco/blockchain/",
        "https://www.eventbrite.com/d/ca--san-francisco/biotech-health-tech/",
        "https://www.eventbrite.com/d/ca--san-francisco/startup-business/",
        "https://www.eventbrite.com/d/ca--san-jose/ai-startup/",
        "https://www.eventbrite.com/d/ca--palo-alto/ai-startup/",
        "https://www.eventbrite.com/d/ca--mountain-view/ai-startup/"]}'),
  ('partiful_sf',            'Partiful (SF)',          'browser',       'sf_bay', 50,
     '{"url":"https://partiful.com/explore/sf"}'),
  ('google_sf',              'Google Search',          'browser',       'sf_bay', 60,
     '{"queries":["AI founder event San Francisco Bay Area this week",
                  "founder dinner SF this week",
                  "startup demo day Bay Area this week",
                  "venture capital investor event SF this week",
                  "fintech event San Francisco this week",
                  "crypto blockchain founder event Bay Area this week",
                  "longevity biotech investor event Bay Area this week",
                  "AI hackathon San Francisco Bay Area",
                  "tech startup pitch night San Jose Palo Alto this week"]}');

insert into feeds (id, name, region_id, categories, source_ids, curator, model, min_score, post_schedule, scoring_rubric) values
  ('bay_founder', 'Bay Area — Founders & Investors', 'sf_bay',
   '{ai,longevity,fintech_blockchain,founder_investor,hackathon}',
   '{luma_sf_discover,luma_founders_club,luma_founders_bay,luma_frontier_tower,
     cerebral_valley,eventbrite_bay,partiful_sf,google_sf}',
   'founding_curator',
   '<< top-tier frontier model, pinned at build time >>',
   6.0,
   '{"daily_hour":7,"weekly_dow":7,"weekly_hour":18}',
   '<< see §11.2 for the rubric contract >>');
```
*(Eventbrite slugs and Google queries are validated at build time; additional Luma discover places for San Jose / the Peninsula are added as rows if they exist.)*

---

## 9. Ingestion

### 9.1 Sources & fetch operations

| Operation | Method | Sources covered |
|-----------|--------|-----------------|
| 1 | Luma API (HTTP) | `luma_sf_discover` + 5 calendars (Founders Club, Founders Bay, Frontier Tower, ClawCamp) |
| 2 | Site JSON-LD (HTTP) | `conference_sites` — standalone conference domains |
| 3 | Browser scrape | `supermomos_sf` |
| 4 | Browser scrape | `cerebral_valley` |
| 5 | Browser scrape | `eventbrite_bay` (multi-city) |
| 6 | Browser scrape | `partiful_sf` |
| 7 | Browser scrape | `evion_sf` (aggregator) |
| 8 | Browser scrape (Google, via Browserbase) | `google_sf` |

(Speaker research also uses Browserbase + Google, but as a pipeline step — §11.3 — not one of
the event-fetch operations.)

**`site_jsonld` — standalone conference sites.** A conference on its own domain is on no
platform we scrape. Rather than a scraper per conference, this reads the schema.org `Event`
markup such sites already publish for Google's event rich results, so tracking a new one is a
URL in config. A plain fetch, since JSON-LD is in the served HTML.

**Aggregators relist, they don't duplicate.** Evion links out to the ORIGINAL event page, so its
rows collapse into ours via URL dedup (§10). Its real contribution is Evion-hosted events plus
platforms we don't scrape directly.

**Region guard.** A followed calendar is not a place — the same organiser runs SF events and
"ClawCamp Nairobi" — and an aggregator's ordering depends on where the scraper's proxy exited.
Every global source therefore checks each row against a Bay Area matcher before emitting it,
failing OPEN when no location is given so listings without a city aren't lost.

**Known coverage gap.** Luma's SF discover feed returns only ~70 upcoming events, so anything on
a Luma calendar we don't follow is invisible unless an aggregator relists it. Adding calendars
is the cheap fix; the `site_jsonld` kind and the conference-tier Google queries cover the
self-hosted end.

**Luma specifics.** The list endpoints omit attendance and the full host/guest list, and their
description is a ~150-char teaser. Attendance, hosts and exact times come from the detail
endpoint (which accepts a public slug as well as an api_id); the full description comes from the
event page's JSON-LD. Page loads are rate-limited far harder than the API, so descriptions are
fetched slowly, capped per run and circuit-broken on the first 429, catching up across days.
API calls retry 429/5xx with backoff and `Retry-After` — a dropped call used to silently lose an
event's attendance rather than raise an error.

### 9.2 Adapter contract
Every source implements an async adapter keyed by `kind`:
```ts
type Adapter = (source: SourceRow) => Promise<NormalizedEvent[]>;
// NormalizedEvent: title, url, status, startsAt (UTC), endsAt, venueName,
// address, city, regionId, description, hosts, speakers, guestCount,
// categories, sourceEventId, raw
```
The runner normalizes title/venue, computes `content_hash`, and upserts on `(source_id, source_event_id)`. Cancellations/postponements set `status`. Detailed extraction per source is in **Appendix A**.

Adapters that pull a whole region (`luma_discover`, `browser` search pages, `site_jsonld`) apply a
**Bay Area guard** before emitting, since one calendar can host events in three countries. The
guard reads city/address/venue and drops what is plainly elsewhere rather than what is merely
unlabelled — an event with no location survives to scoring, where it can be judged.

### 9.3 Source strategy & resilience
Each source sits behind its own adapter so one platform's change can't cascade.

- **Google search is a first-class browser source, run via Browserbase.** It supplies unique long-tail inventory (smaller platforms, Meetup, university/VC pages, South Bay/Peninsula events) that the other sources miss. Residential proxies handle blocking; requests are spaced and the adapter is monitored for schema drift like any other. Google's ToS discourages automated results scraping — a documented, accepted tradeoff for this product; the official Meetup GraphQL API stays available as an optional future supplement, not a replacement. (Not legal advice.)
- **Undocumented endpoints are isolated and monitored.** Luma's `discover`/`calendar` endpoints are internal APIs that can change without notice: validate the response schema each run and alert on drift; retain `events.raw` so a parser fix can re-hydrate history; treat a failure as per-source, not fatal.
- **A reliable backbone plus best-effort supplements.** Luma anchors the feed; other sources (Cerebral Valley, Eventbrite, Partiful, Google) add unique inventory. If every supplement failed, the digest is still useful from Luma alone.
- **Publishing responsibly.** Surfaces link out to the source, show short snippets not full descriptions, and attribute the source.

### 9.4 Timezone normalization at ingest
Every source time is converted to **UTC at ingest** with IANA timezone data; naive times are
localized to the source/region tz first. Luma is UTC; Partiful is mixed; Eventbrite is local
display. All paths end in UTC, DST handled automatically, no hardcoded offsets.

The non-obvious part is the zone-less string. `Date.parse("2026-07-30 11:30")` resolves against
the **machine's** zone, so the same code was correct on a Pacific laptop and seven hours early on
Vercel (UTC) — an 11:30 AM Stanford summit posted as 4:30 AM. `parseToUtc` therefore routes
zone-less input through `wallClockIn(region.timezone)` instead of the platform parser, and the
time tests run under `TZ=UTC` so a Pacific dev machine can never hide the bug again.

A second trap: Luma returns **midnight** for events with no announced time. That has to be
detected in *both* the local zone and UTC — checking only one lets a real midnight-UTC event be
discarded, or a placeholder be shown as a 12:00 AM start.

## 10. Deduplication & Canonicalization

The same event often appears on several platforms with slightly different titles. Title-only matching both false-merges distinct events and misses true duplicates, so TLDR Events uses two identity levels and a multi-signal match. Multi-city coverage increases duplicates; the pipeline absorbs them.

### 10.1 Two identity levels
- **Source identity** — `(source_id, source_event_id)`. One row per listing; re-fetches upsert in place.
- **Logical event** — several source rows for one real event, grouped under a shared `canonical_group`.

### 10.2 Matching pipeline (signals combined)
**Stage 0 — same event URL:** rows whose event URLs normalise to the same host+path are one
event, full stop. Aggregators (Cerebral Valley, Evion, Google) link to the ORIGINAL page, so this
is what collapses a relisting into the first-party row — `luma.com` and `lu.ma` are the same
host, and query strings (`?utm_source=cv-events`) are stripped.
**Stage 1 — deterministic key:** `canonical_key = normalized_title | start_local_date | city`
(`start_local_date` in the region tz, not UTC, to avoid midnight mismatches).
**Stage 2 — fuzzy fallback:** for rows not grouped above, compare candidates sharing the **same
start date** and **same/nearby venue** (`venue_normalized`, same `city`, or lat/lng within ~200m),
then compare titles by token-set ratio; group when **≥ ~90**.

Two hard-won constraints on Stage 2:
- **City matching tolerates granularity.** Sources describe one place at different levels
  ("Berkeley" vs "UC Berkeley Campus"), so one city string containing the other counts as nearby.
- **Containment needs ≥3 tokens in the shorter title.** Containment alone scores 100 whenever the
  shorter title is a subset, which merged "Builders Night" into "Agentic Builders Night" and
  "Demo Day" into "YC Demo Day". A ratio floor could not separate those from legitimate merges —
  "Demo Day"/"YC Demo Day" (72.7) sits *below* "AI Founder Dinner"/"AI Founders' Dinner @ SoMa"
  (73.9), which must merge — but a token-count guard separates them cleanly.

Combining title + date + venue/city is far more precise than title alone: two different events at
one venue on one day stay separate. Known residual: an event listed on two different platforms
with no shared URL, where one row has a venue but no city and the other the reverse, will not
merge. Fixing it would require trusting "same date + similar title" regardless of location, which
risks *hiding* genuinely distinct events — a rare duplicate is the better failure.

### 10.3 Enrichment & primary selection
Within a `canonical_group`: set `is_primary` on the lowest-`priority` (most authoritative) row; enrich it with the best field from any member (`max(guest_count)`, longest description, union of speakers/hosts, most specific venue, missing coordinates); `status` follows the most recently updated member. Keep all rows (provenance); reads/scoring/delivery use **`is_primary` + `status='active'`** only. Scoring runs once per logical event per feed.

---

## 11. Curation & Scoring

Curation is the product. Scoring runs in stages and is parameterized per feed. **Every primary active event in the feed's region is scored** — ingestion is wide, and the scoring bar (not the source list, not a category tag) is the filter.

### 11.1 First-pass signal (fallback)
A cheap keyword + signal heuristic (topic match, guest count, notable speakers, source quality), baseline 3/10. Pre-filter and fallback only; never the primary signal for delivered content.

### 11.2 Editorial score + TL;DR (the moat)
For each primary `(event, feed)` needing a score, the model is called with the feed's
`scoring_rubric` and the researched people signals (§11.3). The score is a **quality** score —
profile-agnostic (§15 layers fit on top).

**What drives the score, in priority order:**
1. **Relevance** to an investor/founder — is the topic and audience on-target?
2. **Event type / format** — founder–investor summits, demo days, pitch nights, VC/LP/GP
   gatherings, curated dinners, hackathons, accelerator/builder-community events, substantive
   talks.
3. **Topic importance & timeliness** — frontier AI, agents, robotics/physical AI, longevity,
   stablecoins/payments.
4. **Apparent quality** — host reputation, curation/exclusivity, and scale where it indicates a
   serious event.

**Speakers count for much more than hosts — and an unknown room never lowers a score.**
This is the biggest correction from v5, which weighted "who's in the room" as the dominant
signal. Two things forced it: named attendee lists are rarely published, so weighting the room
wrote good events down to the 4s for lacking data; and organisers appear on *every* listing, so
counting them as the line-up inflated ordinary meetups. Now:
- **Billed speakers** are a strong lift, judged on seniority and recognisability, not head-count.
- **The organiser** is a mild one. A `host_quality` signal is informed by a **HOST TRACK RECORD**
  built from our own history — events organised, average observed attendance, average prior
  score. Attendance carries the weight because it is observed from the platforms; the prior score
  is labelled in the prompt as our own earlier opinion, because feeding a model its own
  judgments back as independent evidence ratchets a host upward forever. Only organisers with
  ≥3 events are reported.
- **Absence of names never caps or lowers the score.** An event can and should reach 8–10 with
  nobody billed.

**The line-up is usually in prose, not in the structured fields.** Platforms routinely leave the
guest list empty — or fill it with unrelated attendees — while the write-up names the speakers
("Invited Speaker: 1) …"). The scorer therefore extracts the billed line-up itself into
`signals.key_speakers`, and delivery prefers those names. Model extraction handles any phrasing;
a regex would handle one listing.

Output is **structured JSON** via a forced tool call, mapping to columns:
```json
{ "score": 8.7, "category_tag": "ai", "industry_relevant": true,
  "signals": {"attendee_count": 40, "speaker_quality": 9, "host_quality": 4,
              "key_speakers": ["Yufei Zhao — Member of Technical Staff, OpenAI"]},
  "tldr": "Dinner with the founders of two Series-A AI-infra startups + two a16z partners — small, high-signal room." }
```

**Description quality is a scoring input, not a detail.** Stored descriptions once averaged ~214
characters — the list-endpoint teaser — so the scorer was judging events nearly blind and could
not have seen a billed line-up even in principle. Enriching from the event page raised the
in-window average past 650, which is what made speaker extraction possible at all.

**Rubric development.** Versioned in code (`RUBRIC_VERSION`); bumping it re-scores the catalogue
on the next runs. Iterations are measured against a labeled set, never tuned on vibes.

### 11.3 Speaker & host research → the speaker profile database (§8 `people`)
"Who is in the room" is a first-class signal, so before scoring the pipeline resolves an event's named speakers/hosts and researches each one, building a persistent **speaker/host profile database** (`people`).
- **Resolve:** extract named speakers/hosts (Luma `featured_guests`, host fields, description); normalize names.
- **Research via Google + Browserbase (cached):** for each person not already in `people` (or past `ttl_days`), run a Google search through the same Browserbase residential session used for scraping — query the name plus any context (company, "founder"/"investor"/"partner"; if thin, a `{name} LinkedIn` follow-up). Capture the knowledge panel and the top results (LinkedIn, Crunchbase, company/fund pages, news). The model then synthesizes a structured profile — role, company, affiliations, links, a short bio, a prominence signal 0–10, and a one-line note (e.g. "Partner at Sequoia"; "founder of a $1B+ company"; "leading longevity researcher") — written to `people` and reused across every future event that person appears in.
- **Feed into scoring:** the scorer receives the profiles/prominence for the event's people, turning "quality of speakers" and (as a proxy) "quality of attendees" into concrete inputs rather than guesses — and letting the TL;DR name names.
- **Cost control:** research each person once, then reuse from the database (re-research only after TTL); only research named, plausibly-notable people (skip unnamed/generic); space browser requests and run it incrementally, like scoring. Budgeted in §5.

### 11.4 Incremental scoring (cost control)
Only `(event, feed)` pairs with **no score row** or a **changed `content_hash`** are scored; each event is scored once per rubric version. Cost scales with *distinct primary events × feeds × rubric versions* and *distinct new people*, not with fetch frequency or audience size. Token spend logged per run.

### 11.5 Relevance is the score, not a category gate (so nothing great is missed)
Because the rubric already knows the reader and the niches, **relevance is enforced by `score`, not by matching `events.categories`.** The scorer's candidate set is **every primary active event in the feed's region within the forward window** — not filtered by category — so an event the heuristic tagger mislabeled or missed is still scored. Delivery then filters on `min_score` + region + window only. Surfaces group/filter by the **model-assigned `scores.category_tag`**, never the ingest heuristic.
**Recall audit:** periodically sample events scoring just below `min_score` (e.g. 5.0–6.0) for curator review; systematic under-scoring is a rubric bug to fix, not an acceptable miss. Source breadth is the other recall lever — add sources as coverage gaps appear.

### 11.6 Tiers
| Tier | Score | Label |
|------|-------|-------|
| 🔥 | 8–10 | Must Attend |
| ⭐ | 6–7.9 | Strong Pick |
| 👀 | < 6 | Worth a Look |

---

## 12. Delivery: Telegram (flagship, public)

Telegram is the primary consumption surface at launch — a **public channel** plus an on-demand bot, both reading the store.

### 12.1 The group = the digest
A per-feed **public** Telegram group receives scheduled ranked digests, driven by
`feeds.post_schedule`:
- **Daily at 17:00 PT**, covering **tomorrow** — an evening preview, so the reader can plan the
  next day. (v5 posted at 07:00 covering today+tomorrow.) The gather chain runs earlier the same
  afternoon so the post reports fresh data; the post itself is held until the chain has landed.
- **Weekly Sunday 18:00 PT** — the ranked shortlist for the next 7 days.

**One compact message. No inline buttons. Direct source links. No per-event summary.** Each block:

```
🤖 <linked title>
Tue, Jul 28 6 PM · 📍 San Francisco · 👥 25 · <Official site>
Lucy Lawlor, Betty Wu, Edwina Yeo 🎤
```

- The **category emoji is the bullet** (🤖 AI · 🧬 Longevity · ₿ Web3 · 🧑‍💼 Founders · 🛠️ Hackathon),
  with 🎤 explained in the legend as "who's speaking".
- **Attendance is omitted when unknown** rather than printed as `👥 0`, which read as a dead event.
- **Location** is normalised to the town, since sources write it at wildly different granularity.
- A **deduped multi-source event offers each distinct destination** (e.g. Luma *and* the host's
  own site); links dedupe by destination AND by label, so two Eventbrite listings of one event
  don't present a meaningless choice.
- The **daily is trimmed**: every Must Attend, plus the best ~40% of the lower tiers, with a
  footer linking the rest at TLDRevents.com. An untrimmed list filled the whole message.
- Long posts truncate under the 4096-char limit; a zero-event weekly uses a "quiet week" template.

Every post is logged to `digest_posts`; a forced/manual send is recorded as the day's post so the
scheduler cannot post on top of it.

### 12.2 The bot = on-demand
A webhook-based bot (no polling) answers in the same format. Alongside `/today`, `/tomorrow`,
`/week`, `/nextweek`, **bare-word shortcuts** work: `t`, `tmr`, `w`, `nw`, and **any weekday name**
(`thursday`, `thurs`, `thu`) resolving to that day's next occurrence, today included. A shortcut
only fires when the word is the whole message, so ordinary chat can't trigger a digest. Every
reply header names its actual date ("Today — Tue Jul 28"), since a relative word alone is
ambiguous when read later.

`/usehere` (admin-gated) rebinds the scheduled digests to the current chat, so the bot can be
moved to a new group without a redeploy.

**Operational note:** bare-word shortcuts require group privacy to be disabled for the bot in
BotFather, and **the webhook must not sit behind a redirect** — Telegram does not follow them, so
a change of primary domain silently kills the bot with no error anywhere.

### 12.3 Digest poster worker
Runs as the final stage of the single pipeline cron (§16), not as its own job. For each enabled
feed it resolves whether a `daily` or `weekly` post is due from `feeds.post_schedule`, in the
feed's region timezone, then:

1. Query primary, active, in-region events in the window clearing `min_score`.
2. Skip an empty daily entirely; an empty weekly emits the "quiet week" note.
3. Render one message (§12.1) and send.
4. Log to `digest_posts` — including a failed send, so a total failure is retryable while a
   partial one is not re-sent from scratch.

Dueness is a **window, not an instant**: due from the scheduled time for several hours after, so a
missed cron tick delays rather than drops the day, with `postedSince` guaranteeing one post. Both
`daily` and `daily_manual` count as that day's post.

---

## 13. Delivery: Web (public)

The public face and discovery surface. Next.js (App Router) reading the same store:

- **Four ranked horizons — Today · Tomorrow · This Week · Next Week** — plus **per-day pages** at
  `/day/YYYY-MM-DD` covering four weeks ahead. The horizon you're on leads the nav at full size;
  the other three shrink to chips, costing one band instead of four.
- **A browse calendar** shows four weeks with the curated event count per day (the count doubles
  as a heat indicator), each day linking to its own page. It is open beside the headline on wide
  screens — using width the hero was wasting — and collapsed under "Select by date" on a phone,
  re-evaluated only when the breakpoint is actually crossed.
- **One curated list, no TLDR/All toggle.** Events must be industry-relevant and clear a **6.5
  visible floor**; everything relevant below that sits behind "show N lower-ranked events".
  Choosing a tier explicitly bypasses the floor.
- **When a week runs dry, it falls forward.** "This week" shrinks as the week goes on and by
  Sunday covers a single day, which regularly left an empty board while the week ahead was full.
  If *nothing* clears the floor, next week is appended and a badge in the date tile says so —
  otherwise next week's dates under a "This Week" heading read as a broken filter.
- **Every card** shows the score to one decimal, tier, niche tag, time (visitor-localized via
  `Intl`, PT default), location, attendance, researched notables and the one-line TL;DR.
- **Multi-source events offer a choice.** Where a deduped event exists in more than one place,
  the card lists each destination and clicking the card opens a chooser dialog.
- **Clicks route through `/api/click`**, which logs to `click_events` then 302s to the source.
  An `alt` parameter selects an alternate destination, validated against the same canonical group
  — the target is always resolved from the database, never from the query string, so it cannot be
  used as an open redirect.
- **Filters** (topic, tier) live in a collapsible panel whose summary reports what's active, so a
  filter set earlier can't masquerade as missing events.
- Mobile is the priority surface: measured, the first event card starts at y≈514 on a 390×844
  viewport with the next one peeking.

### 13.1 SEO & answer-engine optimisation

Both audiences are served by the same work: making the page's meaning explicit rather than
inferable from styled markup.

- **schema.org structured data.** Each board page emits a `CollectionPage` whose `mainEntity` is
  an **`ItemList` of `Event`s in ranked order**, with times, place, description and the curated
  score as an `AggregateRating`; the layout adds `WebSite` + `Organization`. The ordering is the
  product's actual claim — *these* events, ranked *this* way, for *this* day — and is what lets an
  answer engine say "the top event on Thursday is X". Event `url` cites the source's registration
  page, not the click redirect, and **only events visible by default are described**, since
  marking up the hidden tail would claim more than the page delivers.
- **Crawl surface.** Per-route titles and descriptions, canonical URLs, a generated OG image, and
  a sitemap covering all 32 pages including every day page (the root page shares a segment with
  the root layout, so the layout's title *template* does not apply there — it needs its own).
- **`robots.txt` names the AI crawlers explicitly** — GPTBot, OAI-SearchBot, ChatGPT-User,
  ClaudeBot, PerplexityBot, Google-Extended, CCBot and others — rather than relying on the
  wildcard, so a later tightening can't silently cut off the engines we want indexing this.
- **`/llms.txt`** gives a model the site's purpose, the page map, **what the 0–10 score means** so
  a number is never quoted without its definition, and the current top events with times, places
  and source links. Regenerated per request: a stale events list is worse than none.
- Event titles are real headings inside an h1→h2→h3→h4 hierarchy, so their text is indexed as page
  topics rather than styled bold.

Additive — reads the same store, so no schema change to add it.

---

## 14. Delivery: Email (Phase 2 — deferred)

The full email design — double opt-in lifecycle, timezone-aware dispatch worker, Resend integration, compliance, and four supporting tables — is preserved in **Appendix D** and ships in Phase 2. Nothing in Phase 1 depends on it; adding it is new tables + a dispatch worker, no changes to ingestion, dedup, scoring, or existing surfaces.

---

## 15. Personalization & Profile-Based Ranking (Phase 3 — architecture)

Today the feed's rubric encodes one reader (a founder/investor). The architecture generalizes to *many readers* by splitting the score:

- **Quality (profile-agnostic)** — how good is this event, period: attendee count/quality, researched speaker quality, host prestige, signal. This is what the frontier model produces today and stores in `scores.score`. Scored once; shared by everyone.
- **Fit (profile-specific)** — how relevant to *this* reader's goals and tastes. A **co-founder-seeker** boosts hackathons, builder dinners, and founder meetups; an **investor** boosts demo days and LP/GP gatherings; someone **looking to join** boosts hiring/showcase events; an **existing founder** boosts peer dinners and operator talks.

**Final rank = combine(quality, fit, preferences).** Fit is cheap relative to quality — weights or a light rules/model pass over the event's tags and researched signals, computed per `(event, profile)` and cached. Quality never re-runs per profile, so cost stays bounded regardless of how many profiles exist.

**Reader preferences** sit alongside the profile: readers choose which niches and event *types* they want ("dinners and demo days yes, big conferences no"), applied as hard filters or soft boosts in the fit step.

**Slots in without breaking anything.** `scores.score` is already profile-agnostic quality, so nothing re-scores. Personalization adds a `profiles` table, a `profile_id` + `preferences` on the reader, and a fit re-rank at read time — all additive. A reader with no profile gets the quality ranking (today's behavior).

```sql
-- Phase 3 (additive)
create table profiles (
  id          text primary key,          -- 'cofounder_seeker'|'founder'|'investor'|'joiner'
  name        text,
  fit_weights jsonb,                      -- per category/format weight multipliers
  fit_rubric  text                        -- optional light-model guidance
);
-- readers gain: profile_id text references profiles(id), preferences jsonb
-- optional cache: fit_scores(event_id, feed_id, profile_id) → fit numeric, final numeric
```

---

## 16. Scheduling & Jobs

**One cron job drives everything.** Vercel dropped scheduled ticks twice, in different ways:
jobs at minute offsets never fired at all, and later, with everything at minute 0, exactly one
job ran out of each pair that shared a trigger minute — a missed dedup put a duplicate event in
the digest. Rather than keep guessing the scheduler's rules, the project registers a **single**
cron; with one job there is nothing to collide with, and a dropped tick costs ten minutes.

`/api/cron/pipeline` runs **every 10 minutes** and performs **at most one stage per tick**, so no
invocation approaches the function time limit.

| Stage | Local hour | Action |
|-------|-----------|--------|
| `ingest` | from 15:00 PT | Core sources → upsert `events` (UTC) |
| `ingest_extra` | after ingest | Long-tail sources (Partiful, Google, Evion) |
| `dedup` | after ingest | Luma backfill (attendance, times, descriptions) then group + enrich |
| `research` | after dedup | Resolve & research new named people → `people` |
| `score` | after research | Score new/changed primary events |
| `digest` | from 17:28 PT | Post if due per `feeds.post_schedule` |

**Stage completion has two shapes.** Most stages are *once a day*: attempted, then done, so a
missed tick simply retries on the next one. **Scoring is a queue**, not an event — it is
batch-limited per run (40) to stay inside the timeout, so "attempted today" would cap it at one
batch. It declares a backlog check and keeps running until the queue is empty, bounded by
`DAILY_SCORE_CAP` so a permanently-failing event can't become unbounded spend. (This was a real
regression: after consolidating the crons, 327 of 377 events in the window sat unscored — i.e.
invisible to both the site and the digest — because capacity had been sized for three daily
slots.)

**The digest tolerates a missed tick.** It is due *from* its scheduled time for several hours
after, not only during that hour; a missed tick delays the post instead of losing the day. A
forced/manual send counts as that day's post, so the scheduler can't post on top of it.

A lease-based `job_locks` row per stage prevents overlap. Schedules are reasoned in UTC; the
local run hour is resolved with IANA timezone data, so each stage is scheduled at both candidate
UTC hours and the gate admits only the one that is genuinely the right local hour — DST-safe.

---

## 17. Configuration & Secrets

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Postgres (pooled for runtime, direct for DDL/migrations) |
| `LLM_PROVIDER` | `anthropic` (default), or any OpenAI-compatible host — see below |
| `LLM_BASE_URL` | Only for a host without a built-in base URL |
| `LLM_API_KEY` | Editorial scorer + speaker-research synthesis |
| `SCORING_MODEL` / `RESEARCH_MODEL` | Model ids; defaults are per provider AND per task |
| `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` | Browser automation (scrapes + speaker research) |
| `TELEGRAM_BOT_TOKEN` | Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | Header secret for the bot webhook |
| `TELEGRAM_CHANNEL_ID` | Default digest chat (per-feed override on `feeds`) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Admin command whitelist (`/usehere`, forced posts) |
| `CRON_SECRET` | Guards the cron endpoint |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin — drives canonical tags, sitemap, structured data, digest footer |
| `NEXT_PUBLIC_TELEGRAM_URL` | "Join on Telegram" link |
| `SCHEDULE_TZ`, `PIPELINE_START_HOUR`, `DAILY_SCORE_CAP`, `SCORE_BATCH`, `SCORE_CONCURRENCY` | Pipeline tuning (all defaulted) |

Feeds, sources, regions and (Phase 3) profiles are **data, not env**.

### 17.1 Switching the AI model

Scoring and research share one client. `LLM_PROVIDER=anthropic` uses the Claude SDK; **any other
value** is treated as an OpenAI-compatible `/chat/completions` host — `deepseek`, `qwen`,
`openrouter`, `together`, `groq`, `openai` carry built-in base URLs, anything else needs
`LLM_BASE_URL`. That path is a plain fetch rather than a second SDK: the request shape is stable
across those hosts and only one forced tool call is needed.

```
LLM_PROVIDER=deepseek      LLM_PROVIDER=qwen
LLM_API_KEY=sk-...         LLM_API_KEY=sk-...
SCORING_MODEL=deepseek-v4-pro    SCORING_MODEL=qwen3-max
RESEARCH_MODEL=deepseek-v4-flash RESEARCH_MODEL=qwen3-flash
```

Structured output is forced via `tool_choice` on both paths, with JSON salvaged from a prose
reply as a fallback — cheaper models are exactly where that happens, and losing the event would
be worse. **Tool calling is effectively required**; a host without it degrades to best-effort.

Model names are resolved `feeds.model` → `SCORING_MODEL` → per-host default. The per-feed pin is
how to A/B a cheaper model on one feed before committing — but **a pin must not outlive the
provider it was written for**, and one did: `feeds.model` held `claude-opus-4-8`, so switching
`LLM_PROVIDER` to `deepseek` kept sending a Claude model name to DeepSeek. Every scoring call
returned 400 while the credentials, base URL and env vars were all correct. `resolveModel()` now
drops a model whose name plainly belongs to another vendor, names the stale value in an error
log, and falls back to the provider's default.

Defaults are per **host**, not per protocol: a DeepSeek model name sent to Groq fails exactly like
a Claude name sent to DeepSeek. A host with no built-in default demands `SCORING_MODEL` rather
than guessing.

Switching model **does** re-score the catalogue. `scores.model` is part of the staleness test
alongside `content_hash` and `rubric_version`, because a change of model is a change of judgment:
leaving old scores in place ranks events the new model has never seen against ones it has, which
is not a ranking so much as two editors' opinions sorted into one list. The re-score is bounded by
the batch size and `DAILY_SCORE_CAP`, and each old score stays visible until its replacement is
written, so the board never empties mid-migration.

Re-scoring **overwrites** (`scores` is keyed on `event_id + feed_id`), so snapshot the table before
changing model on a live board if the old ranking is worth keeping:
`create table scores_backup as select * from scores`.

`GET /api/cron/llm-check` (cron-authed) reports the resolved provider, base URL, model names and
key shape — never the key. `?live=1` makes one real call and returns the provider's own error,
which is the fastest way to tell "wrong key" from "wrong model name" from "wrong host".

**Batch size is a function of the model, not a constant.** `SCORE_BATCH` × per-event latency has
to fit inside the route's `maxDuration` (300s), and a reasoning model changes that arithmetic
sharply. Measured on the same 40 events:

| | input/event | output/event | latency/event | batch of 40 |
|---|---|---|---|---|
| `deepseek-chat` | 2,725 | 219 | 0.6s | 24s |
| `deepseek-v4-pro` | 3,270 | 1,282 | 5.8s | **231s — 77% of the limit** |

Thinking is nearly all of that: ~6× the output tokens and ~10× the wall clock for ~1.2× the input.
A batch sized for a direct model runs a reasoning model to the edge of the function limit, where
one slow call loses the whole batch. Pro therefore runs `SCORE_BATCH=24` with
`SCORE_CONCURRENCY=6` (~92s). **Re-measure both when changing model** — the numbers above are the
method, not a constant.

**Cost shape.** Scoring dominates: one call per new/changed event at roughly 4–6k input tokens
(rubric + description), a few hundred out. Research is a second, smaller call per newly-seen
person. At ~40 new events a day the per-million *input* price is what decides the bill.

Phase 2 adds `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SENDING_DOMAIN`, `PHYSICAL_ADDRESS`
(Appendix D).

### 17.2 Database access control

All tables have **Row-Level Security enabled with no policies**, and the `anon`/`authenticated`
grants are revoked (including default privileges for future tables). Supabase serves the public
schema over PostgREST using the anon key, and that key is designed to be public — so RLS, not the
key, is the boundary. The pipeline is unaffected because it connects over the Postgres protocol
as the table owner, and owners bypass RLS; `FORCE ROW LEVEL SECURITY` is deliberately **not** set,
as it would apply RLS to the owner and break the pipeline. `service_role` keeps its grants for
the Supabase dashboard.

---

## 18. Build Plan

**Milestone 0 — De-risk the scorer (before any infra).** Pull ~2 weeks of Bay Area events by hand (Luma first), draft the v1 `bay_founder` rubric (founder/investor lens, incl. hackathons), do a manual pass of speaker research on a few events (Google lookups by hand), score them, and eyeball the ranking. Build the 30–50 event labeled evaluation set. If the top tier isn't trustworthy here, nothing else matters.

**Milestone 1 — Store & ingestion.** Stand up Postgres, apply the Phase 1 schema, seed region + 8 sources (multi-city Eventbrite; Google via Browserbase). Build the ingestion runner and adapters, normalizing to UTC. Confirm events land, upsert, and `status` propagates.

**Milestone 2 — Research, dedup & scoring.** Add the canonicalizer (§10), the speaker-research step + `people` database (Google via Browserbase, §11.3), and the editorial scorer (§11) reading `feeds.scoring_rubric` and people signals, writing `scores` incrementally. Measure against the M0 evaluation set; iterate the rubric until the top tier is trustworthy. Wire the recall audit.

**Milestone 3 — Telegram (QA then public).** Build the digest poster, channel format, inline buttons with click logging, and bot commands. Run in **shadow mode** to a private test channel for ~2 weeks while the curator reviews every digest; then open the public channel.

**Milestone 4 — Web (public).** Ship SEO-indexed public browse pages (this week / next week, niche/tier filters, Follow CTA) with outbound click logging.

**Milestone 5 — Email & Expand (Phase 2).** Add email (Appendix D) and a second feed (new niche/region) purely as configuration.

**Milestone 6 — Personalize (Phase 3).** Add profiles + preferences + the fit re-rank (§15). No changes to existing tables — additive only.

---

## 19. Open Questions

1. **Google query set & block rate** — which queries yield the most unique long-tail inventory via Browserbase, and what's the observed block rate and cost at real volume? (Meetup's official API stays available as an optional future supplement.) (Milestone 1.)
2. **Speaker-research depth & cost** — how deep should each Google/Browserbase person lookup go, what's the notability threshold below which a name isn't worth researching, and what does it cost at real volume once cached? (Milestone 2.)
3. **Attendee-quality data** — beyond hosts/featured guests/host-org prestige, is any real attendee-list signal available on any source, or is proxy-only the ceiling?
4. **Fintech scope** — how far beyond crypto/blockchain (payments, capital markets, insurtech), and where's the line vs. generic finance-conference noise? (M0 rubric.)
5. **Profile taxonomy (Phase 3)** — the initial set is co-founder-seeker / founder / investor / joiner; which others matter, and do readers pick one or blend several?
6. **Virtual events** — tag and down-weight (current default) or exclude?
7. **Weekly digest timing** — Sunday 6 PM PT vs. Monday morning; tune via `feeds.post_schedule` once click data exists.

---

## 20. Appendices

### Appendix A — Source Extraction Recipes

**Browser session (residential proxy; reused across browser scrapes and speaker research):**
```ts
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID!,
  proxies: [{ type: "residential", country: "US" }],
});
const browser = await chromium.connectOverCDP(session.connectUrl); // playwright-core
const page = browser.contexts()[0].pages()[0];
```
Residential proxies avoid IP blocks. Reuse one session across browser scrapes and speaker lookups; space navigations 5–10s apart; on a source failure, proceed with the rest.

- **Luma** (`luma_discover` / `luma_calendar`, HTTP): `GET https://api.luma.com/discover/get-paginated-events?discover_place_api_id={place_id}&pagination_limit=50&pagination_cursor={cursor}` and `GET https://api.luma.com/calendar/get-items?calendar_api_id={cal_id}&...`. Resolve slug→id via `GET https://api.luma.com/url?url={slug}`. Times UTC (`...Z`). Capture `featured_guests` for speaker research. Internal endpoints — apply the §9.3 drift check.
- **Cerebral Valley** (`browser`): navigate, scroll to load all cards, extract via `document.querySelectorAll('a[aria-label^="Open event:"]')` → title (`h3`), link, date/time, location, description. `to_utc(...)`.
- **Eventbrite** (`browser`): scrape multi-city search URLs; `h3` title, `a[href*="eventbrite.com/e/"]`, `p` date/location; localize via `to_utc(...)`. Cancellation banners → `status='canceled'`. *(Expansion: official Eventbrite API.)*
- **Partiful** (`browser`): read `window.__NEXT_DATA__.props.pageProps` (`trendingSection.items[].event`, `sections[].items[].event`, `feedItems[].event`): `id`, `title`, `startDate`, `locationInfo.mapsInfo.name`, `goingGuestCount`, `interestedGuestCount`, `description`. Null guest counts → 0. Times mixed → localize naive to region tz.
- **Google** (`browser`, residential proxy mandatory): run the configured founder/investor + hackathon queries with 3s+ between them; extract the event carousel/rich results and event-platform links (Luma, Eventbrite, Partiful, Meetup, university/VC pages). Heavy overlap with other sources → resolved by §10. Adds unique long-tail inventory and South Bay / Peninsula events the other sources miss. Highest block risk of the sources; proxies + spacing mitigate. (Optional future supplement: official Meetup GraphQL API.)

- **Luma detail & page enrichment** (HTTP, no browser): the list endpoint returns a ~200-char teaser and **no attendance**, both of which the rubric needs. `GET https://api.luma.com/event/get?event_api_id={slug_or_api_id}` supplies guest count and the full record; the event page's JSON-LD supplies the full description. This path is rate-limited in practice — a ~200-page burst got a laptop IP 429'd — so it runs at concurrency 2 with a ~350ms pause, a per-run cap, exponential backoff honouring `Retry-After`, and a circuit breaker that stops the run rather than losing the queue.
- **Supermomos** (`browser`): community events page; cards carry title, link, date/time and venue.
- **Evion** (`browser`, priority 55): an aggregator that mostly relists Luma/Partiful and links to the ORIGINAL page, so its rows merge into the first-party ones via Stage-0 URL dedup (§10.2). Low priority keeps the first-party row authoritative; its unique contribution is Evion-hosted events and long-tail platforms.
- **Conference sites** (`site_jsonld`, HTTP): standalone conference domains publish schema.org `Event` markup already. The adapter walks `@graph` and nested arrays, accepts `Event` subtypes (`BusinessEvent`, `EducationEvent`, …), normalizes `location` (`Place` → venue/city), and applies the Bay Area guard. This closed a real gap: a robotics developer conference at Fort Mason existed on no platform being scraped. Adding a conference is one URL in the source config.

**Speaker/host research (Google via Browserbase → `people`):** reuse the same residential session. For each unresolved name, search e.g. `"{name}" {company_or_context}` (and, if thin, `{name} LinkedIn`); capture the knowledge panel (title/company/description), the top organic results (LinkedIn `/in/`, Crunchbase, company/fund about pages), and any news. Hand the captured text to the model to synthesize the structured profile (§11.3) and upsert into `people` keyed by normalized name. Skip anyone already fresh in the database. Google's DOM shifts, so prefer robust text extraction (knowledge-panel labels, result titles/snippets) over brittle fixed selectors, and monitor for drift.

### Appendix B — Telegram Formatting

**Times are rendered from IANA timezone data, never a fixed offset**, so DST is correct without
special-casing. Zone-less source strings are interpreted as a wall clock *in the region's zone* —
`Date.parse` resolves them against the machine's zone, which is right on a Pacific laptop and
seven hours wrong on Vercel (UTC). That bug printed an 11:30 AM Stanford summit as 4:30 AM; the
time tests now run under `TZ=UTC` so the machine zone can never mask it again.

**Event block (HTML parse mode).** The category emoji IS the bullet — there is no separate dot:

```
{emoji} <b>{score}</b> <a href="{link}">{title}</a>
   {time} · {short_location} · 👥 {attendance} · {speakers} 🎤
   {tldr}
```

- **Legend** (footer of every digest): `🤖 AI · 🧬 Longevity · ₿ Web3 · 🧑‍💼 Founders · 🛠️ Hackathon · 🎤 Who's speaking`
- **Speakers, not hosts.** The 🎤 line bills the model's `key_speakers` first, then the adapter's
  speaker list, and falls back to hosts only when both are empty (§11.2). The mic sits at the END
  of the names.
- **Location is shortened** to the recognisable part ("Frontier Tower", "Palo Alto"), not a full
  street address.
- **Multi-source events** carry one primary link; the alternates live on the web board's link
  chooser (§13).
- **Size:** cap 4096 chars. A daily digest that would overflow keeps every Must Attend and ~40% of
  the rest, then appends `… +N more at TLDRevents.com` rather than truncating mid-event.
- **Supergroup migration:** on HTTP 400 with `parameters.migrate_to_chat_id`, update the stored
  chat id and retry.

### Appendix C — Source Characteristics & Operational Notes

- **Timezone:** UTC at ingest via IANA data; localize at display only. Never a fixed offset.
- **Deduplication:** never match on title alone — title + date + venue/city (§10). Multi-city coverage raises duplicates; expected and absorbed.
- **Event lifecycle:** adapters propagate cancellations/postponements into `events.status`; surfaces filter to `active` (web shows canceled struck-through for a week). Events, raw payloads, and researched people are **retained indefinitely**.
- **People database:** research each named speaker/host once (Google via Browserbase); reuse across events; re-research after TTL. This is what makes "who's in the room" scoring affordable and lets the TL;DR name names.
- **Nulls to guard:** Partiful `goingGuestCount` null; Luma `geo_address_info` null; Luma `featured_guests` items null (skip).
- **Source character (Bay Area, founder/investor lens):** Luma is the backbone (richest, strong on founder/investor events, exposes featured guests for research); Cerebral Valley overlaps Luma (good enrichment, AI-skewed); Eventbrite is the best structured source for South Bay and surfaces hackathons (now valued); Partiful is social-heavy (filter for relevance); Google adds long-tail unique inventory at the highest block risk; some host calendars mix serious events with reading clubs. Curators tune the rubric to these realities.
- **Cosmetic-change filtering:** date-format or day-of-week-only changes are cosmetic; only flag a change when an actual date shifts, so `content_hash` stays stable and scoring doesn't re-run on noise.
- **Scoring:** keyword scoring flattens fast; the per-feed editorial rubric on a top-tier model, fed by researched people signals, is what produces a trustworthy ranking and a TL;DR that can name names. Keep each rubric living, versioned, curator-owned, and evaluated against the labeled set.

### Appendix D — Phase 2: Email Digest (deferred design)

Ships in Phase 2. Adds four tables and one worker; no changes to Phase 1 tables.

**Schema (Phase 2 migration):**
```sql
create table subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             citext unique not null,
  status            text default 'pending',  -- pending|active|unsubscribed|bounced|complained
  timezone          text default 'America/Los_Angeles',
  confirm_token_hash     text,  -- sha256 of the emailed token; plaintext never stored
  unsubscribe_token_hash text,  -- sha256 of the emailed token; plaintext never stored
  created_at        timestamptz default now(),
  confirmed_at      timestamptz
);
create table subscriptions (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid references subscribers(id) on delete cascade,
  feed_id        text references feeds(id),
  frequency      text not null,          -- 'daily'|'weekdays'|'weekly'
  send_hour_local int default 7,
  send_dow       int,
  min_score      numeric(3,1) default 6.0,
  enabled        boolean default true,
  last_sent_at   timestamptz,
  next_send_at   timestamptz,
  unique (subscriber_id, feed_id)
);
create table deliveries (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid references subscriptions(id),
  sent_at          timestamptz default now(),
  window_start     timestamptz,
  window_end       timestamptz,
  event_ids        uuid[],
  resend_message_id text,
  status           text
);
create table email_events (
  id                uuid primary key default gen_random_uuid(),
  resend_message_id text,
  subscriber_id     uuid references subscribers(id),
  type              text,
  payload           jsonb,
  received_at       timestamptz default now()
);
```

**Subscription lifecycle (double opt-in):** `POST /subscribe` → pending + confirmation email; `GET /confirm?token=` → active, compute `next_send_at`; `GET /unsubscribe?token=` → honored immediately. Tokens are random 128-bit values sent in the links; **only their SHA-256 hashes are stored**, so a DB leak can't mint valid links.

**Dispatch worker:** every ~15 min, find due subscriptions, build the personalized digest (daily = today+tomorrow local; weekly = next 7 days; times in the subscriber's tz), send via Resend transactional API, log deliveries, compute next send (DST-correct).

**Resend integration:** verify the sending domain (SPF/DKIM/DMARC) before real sends; webhooks → `email_events`; on hard bounce/complaint, stop sending; always include a plain-text part; batch and back off as the list grows.

**Compliance (not legal advice):** CAN-SPAM (accurate headers, physical postal address in footer, prompt opt-out), GDPR (double opt-in + easy withdrawal), RFC 8058 one-click unsubscribe headers. Never email `pending`, `unsubscribed`, `bounced`, or `complained` addresses; warm the domain gradually.
