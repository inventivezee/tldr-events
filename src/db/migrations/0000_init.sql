-- TLDR Events — Phase 1 schema (PRD §8). UTC everywhere in the store.
-- Events (incl. raw payloads) and researched people are retained indefinitely.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- Regions: timezone lives here → every surface localizes correctly.
create table if not exists regions (
  id        text primary key,          -- 'sf_bay', 'nyc', 'london'
  name      text not null,
  timezone  text not null              -- IANA, e.g. 'America/Los_Angeles'
);

-- Sources: the scrapers / APIs. Config-driven where possible.
create table if not exists sources (
  id         text primary key,
  name       text not null,
  kind       text not null,            -- 'api'|'luma_discover'|'luma_calendar'|'browser'
  region_id  text references regions(id),
  config     jsonb not null,           -- {place_id}|{cal_id}|{url}|{urls}|{queries}
  priority   int default 100,          -- lower = more authoritative for enrichment
  enabled    boolean default true
);

-- People: the speaker/host PROFILE DATABASE. Each named person researched once
-- (Google via Browserbase, §11.3) and reused across events → attendee/speaker quality.
create table if not exists people (
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
create index if not exists people_prominence_idx on people (prominence);

-- Events: source-level rows, upserted. UTC timestamps only.
create table if not exists events (
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
  canonical_key     text,                  -- deterministic cross-source group key (§10)
  canonical_group   uuid,                  -- shared id for one logical event across sources
  is_primary        boolean default true,  -- the enriched row within a canonical group
  content_hash      text,                  -- change detection (drives incremental scoring)
  raw               jsonb,                 -- original payload (retained indefinitely)
  first_seen_at     timestamptz default now(),
  last_seen_at      timestamptz default now(),
  unique (source_id, source_event_id)
);
create index if not exists events_starts_at_idx on events (starts_at);
create index if not exists events_region_starts_idx on events (region_id, starts_at);
create index if not exists events_canonical_key_idx on events (canonical_key);
create index if not exists events_canonical_group_idx on events (canonical_group);
create index if not exists events_status_idx on events (status);

-- Feeds: the product primitive (niche × region × reader-lens).
create table if not exists feeds (
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
create table if not exists scores (
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
create index if not exists scores_feed_score_idx on scores (feed_id, score);

-- Digest posts: audit of scheduled Telegram channel posts.
create table if not exists digest_posts (
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
create index if not exists digest_posts_feed_kind_idx on digest_posts (feed_id, kind, posted_at);

-- Click events: Telegram inline-button callbacks + web outbound clicks → engagement metric.
create table if not exists click_events (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references events(id),
  feed_id    text,
  surface    text,                       -- 'telegram'|'web'
  clicked_at timestamptz default now()
);
create index if not exists click_events_event_idx on click_events (event_id);
