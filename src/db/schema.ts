// Drizzle schema for type-safe queries. Mirrors src/db/migrations/0000_init.sql
// (which is the source of truth for DDL / extensions / fidelity to PRD §8).
import {
  pgTable,
  text,
  jsonb,
  integer,
  boolean,
  numeric,
  timestamp,
  uuid,
  doublePrecision,
  index,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";
import type {
  PersonRef,
  PersonLinks,
  ResearchSource,
  PostSchedule,
} from "@/types";

export const regions = pgTable("regions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
});

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  regionId: text("region_id").references(() => regions.id),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  priority: integer("priority").default(100),
  enabled: boolean("enabled").default(true),
});

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nameNormalized: text("name_normalized").notNull().unique(),
    displayName: text("display_name"),
    title: text("title"),
    company: text("company"),
    affiliations: jsonb("affiliations").default([]).$type<string[]>(),
    links: jsonb("links").default({}).$type<PersonLinks>(),
    bio: text("bio"),
    prominence: numeric("prominence", { precision: 3, scale: 1 }),
    note: text("note"),
    researchQuery: text("research_query"),
    researchSources: jsonb("research_sources").$type<ResearchSource[]>(),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    ttlDays: integer("ttl_days").default(180),
  },
  (t) => [index("people_prominence_idx").on(t.prominence)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id").references(() => sources.id),
    sourceEventId: text("source_event_id").notNull(),
    title: text("title").notNull(),
    titleNormalized: text("title_normalized").notNull(),
    description: text("description"),
    url: text("url"),
    status: text("status").default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    regionId: text("region_id").references(() => regions.id),
    venueName: text("venue_name"),
    venueNormalized: text("venue_normalized"),
    address: text("address"),
    city: text("city"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    hosts: jsonb("hosts").default([]).$type<PersonRef[]>(),
    speakers: jsonb("speakers").default([]).$type<PersonRef[]>(),
    guestCount: integer("guest_count"),
    categories: text("categories").array().default([]),
    canonicalKey: text("canonical_key"),
    canonicalGroup: uuid("canonical_group"),
    isPrimary: boolean("is_primary").default(true),
    contentHash: text("content_hash"),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique().on(t.sourceId, t.sourceEventId),
    index("events_starts_at_idx").on(t.startsAt),
    index("events_region_starts_idx").on(t.regionId, t.startsAt),
    index("events_canonical_key_idx").on(t.canonicalKey),
    index("events_canonical_group_idx").on(t.canonicalGroup),
    index("events_status_idx").on(t.status),
  ],
);

export const feeds = pgTable("feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  regionId: text("region_id").references(() => regions.id),
  categories: text("categories").array().notNull(),
  sourceIds: text("source_ids").array().notNull(),
  scoringRubric: text("scoring_rubric").notNull(),
  rubricVersion: integer("rubric_version").default(1),
  model: text("model"),
  minScore: numeric("min_score", { precision: 3, scale: 1 }).default("6.0"),
  curator: text("curator"),
  postSchedule: jsonb("post_schedule").$type<PostSchedule>(),
  telegramChannelId: text("telegram_channel_id"),
  enabled: boolean("enabled").default(true),
});

export const scores = pgTable(
  "scores",
  {
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    feedId: text("feed_id")
      .references(() => feeds.id, { onDelete: "cascade" })
      .notNull(),
    score: numeric("score", { precision: 3, scale: 1 }).notNull(),
    tier: text("tier").notNull(),
    categoryTag: text("category_tag"),
    tldr: text("tldr"),
    signals: jsonb("signals").$type<Record<string, unknown>>(),
    model: text("model"),
    rubricVersion: integer("rubric_version"),
    contentHash: text("content_hash"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.feedId] }),
    index("scores_feed_score_idx").on(t.feedId, t.score),
  ],
);

export const digestPosts = pgTable(
  "digest_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedId: text("feed_id").references(() => feeds.id),
    kind: text("kind"),
    postedAt: timestamp("posted_at", { withTimezone: true }).defaultNow(),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    eventIds: uuid("event_ids").array(),
    tgMessageIds: integer("tg_message_ids").array(),
    status: text("status"),
  },
  (t) => [index("digest_posts_feed_kind_idx").on(t.feedId, t.kind, t.postedAt)],
);

export const clickEvents = pgTable(
  "click_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => events.id),
    feedId: text("feed_id"),
    surface: text("surface"),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("click_events_event_idx").on(t.eventId)],
);

export type EventRow = typeof events.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type FeedRow = typeof feeds.$inferSelect;
export type PersonRow = typeof people.$inferSelect;
export type ScoreRow = typeof scores.$inferSelect;
export type RegionRow = typeof regions.$inferSelect;
