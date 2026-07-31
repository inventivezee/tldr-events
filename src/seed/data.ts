// Launch seed — region, 8 sources across 5 fetch operations, and the founder/
// investor feed (PRD §8 "Launch seed"). Sources/feeds/regions are DATA, not code.
import type { SourceKind } from "@/types";

export interface SeedSource {
  id: string;
  name: string;
  kind: SourceKind;
  region_id: string;
  priority: number;
  config: Record<string, unknown>;
}

export const SEED_REGION = {
  id: "sf_bay",
  name: "SF Bay Area",
  timezone: "America/Los_Angeles",
};

export const SEED_SOURCES: SeedSource[] = [
  {
    id: "luma_sf_discover",
    name: "Luma — SF Discover",
    kind: "luma_discover",
    region_id: "sf_bay",
    priority: 10,
    config: { place_id: "discplace-BDj7GNbGlsF7Cka" },
  },
  {
    id: "luma_founders_club",
    name: "Bay Area Founders Club",
    kind: "luma_calendar",
    region_id: "sf_bay",
    priority: 20,
    config: { cal_id: "cal-GjoRQb3KjJWJmwa" },
  },
  {
    id: "luma_founders_bay",
    name: "Founders Bay",
    kind: "luma_calendar",
    region_id: "sf_bay",
    priority: 20,
    config: { cal_id: "cal-jVCYJFvH7OA4SLT" },
  },
  {
    id: "luma_frontier_tower",
    name: "Frontier Tower",
    kind: "luma_calendar",
    region_id: "sf_bay",
    priority: 20,
    config: { cal_id: "cal-Sl7q1nHTRXQzjP2" },
  },
  {
    // Community calendar (lu.ma/clawcamp). Runs SF summits alongside Nairobi and
    // NYC dates, so the adapter's Bay Area check does real work here.
    id: "luma_clawcamp",
    name: "ClawCamp",
    kind: "luma_calendar",
    region_id: "sf_bay",
    priority: 20,
    config: { cal_id: "cal-FwYIAG4ISvpPrbv" },
  },
  {
    id: "supermomos_sf",
    name: "Supermomos (SF)",
    kind: "browser",
    region_id: "sf_bay",
    priority: 25,
    config: { url: "https://www.supermomos.com/community-events/sf" },
  },
  {
    id: "cerebral_valley",
    name: "Cerebral Valley",
    kind: "browser",
    region_id: "sf_bay",
    priority: 30,
    config: { url: "https://cerebralvalley.ai/events?locations=BAY_AREA" },
  },
  {
    id: "eventbrite_bay",
    name: "Eventbrite (Bay Area)",
    kind: "browser",
    region_id: "sf_bay",
    priority: 40,
    config: {
      urls: [
        "https://www.eventbrite.com/d/ca--san-francisco/ai-startup/",
        "https://www.eventbrite.com/d/ca--san-francisco/fintech/",
        "https://www.eventbrite.com/d/ca--san-francisco/blockchain/",
        "https://www.eventbrite.com/d/ca--san-francisco/biotech-health-tech/",
        "https://www.eventbrite.com/d/ca--san-francisco/startup-business/",
        "https://www.eventbrite.com/d/ca--san-jose/ai-startup/",
        "https://www.eventbrite.com/d/ca--palo-alto/ai-startup/",
        "https://www.eventbrite.com/d/ca--mountain-view/ai-startup/",
      ],
    },
  },
  {
    id: "partiful_sf",
    name: "Partiful (SF)",
    kind: "browser",
    region_id: "sf_bay",
    priority: 50,
    config: { url: "https://partiful.com/explore/sf" },
  },
  {
    // Aggregator: mostly relists Luma/Partiful/etc. and links to the ORIGINAL
    // event page, so those rows merge into ours via URL dedup. Low priority
    // (55) keeps the first-party source authoritative for a merged event; the
    // unique contribution is Evion-hosted events and the long-tail platforms.
    id: "evion_sf",
    name: "Evion",
    kind: "browser",
    region_id: "sf_bay",
    priority: 55,
    config: { url: "https://evion.app/events/" },
  },
  {
    id: "google_sf",
    name: "Google Search",
    kind: "browser",
    region_id: "sf_bay",
    priority: 60,
    config: {
      queries: [
        "AI founder event San Francisco Bay Area this week",
        "founder dinner SF this week",
        "startup demo day Bay Area this week",
        "venture capital investor event SF this week",
        "fintech event San Francisco this week",
        "crypto blockchain founder event Bay Area this week",
        "longevity biotech investor event Bay Area this week",
        "AI hackathon San Francisco Bay Area",
        "tech startup pitch night San Jose Palo Alto this week",
      ],
    },
  },
];

// Supplementary sources split into their own cron slot so the slower/long-tail
// scrapes (Partiful, Google) don't get starved by the core sources' time budget.
export const EXTRA_SOURCE_IDS = ["partiful_sf", "google_sf", "evion_sf"];

export const FEED_ID = "bay_founder";

export const SEED_FEED = {
  id: FEED_ID,
  name: "Bay Area — Founders & Investors",
  region_id: "sf_bay",
  categories: [
    "ai",
    "longevity",
    "fintech_blockchain",
    "founder_investor",
    "hackathon",
  ],
  source_ids: SEED_SOURCES.map((s) => s.id),
  curator: "founding_curator",
  min_score: "6.0",
  // Daily digest posts at 17:00 local and covers TOMORROW's events.
  post_schedule: { daily_hour: 17, weekly_dow: 7, weekly_hour: 18 },
};
