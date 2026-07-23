import { describe, it, expect } from "vitest";
import { parseLumaEntry } from "@/ingestion/adapters/luma";
import type { SourceRow } from "@/db/schema";

const source = {
  id: "luma_sf_discover",
  regionId: "sf_bay",
  kind: "luma_discover",
} as unknown as SourceRow;

describe("parseLumaEntry", () => {
  it("maps a well-formed entry", () => {
    const entry = {
      event: {
        api_id: "evt-abc",
        name: "AI Founders Dinner",
        start_at: "2026-07-23T01:00:00.000Z",
        end_at: "2026-07-23T04:00:00.000Z",
        url: "ai-founders-dinner",
        geo_address_info: {
          name: "Frontier Tower",
          city: "San Francisco",
          full_address: "1 Market St, SF",
          latitude: 37.79,
          longitude: -122.4,
        },
        description: "A small curated dinner.",
      },
      hosts: [{ name: "Jane Doe" }],
      featured_guests: [{ name: "Alice Smith", bio: "Founder" }, null],
    };
    const ev = parseLumaEntry(source, entry);
    expect(ev).not.toBeNull();
    expect(ev!.source_event_id).toBe("evt-abc");
    expect(ev!.title).toBe("AI Founders Dinner");
    expect(ev!.url).toBe("https://lu.ma/ai-founders-dinner");
    expect(ev!.starts_at.toISOString()).toBe("2026-07-23T01:00:00.000Z");
    expect(ev!.city).toBe("San Francisco");
    expect(ev!.hosts?.[0].name).toBe("Jane Doe");
    expect(ev!.speakers?.map((s) => s.name)).toEqual(["Alice Smith"]); // null guest skipped
    expect(ev!.categories).toContain("ai");
  });

  it("survives null geo_address_info (Appendix C)", () => {
    const entry = {
      event: {
        api_id: "evt-2",
        name: "Fintech Meetup",
        start_at: "2026-07-24T02:00:00.000Z",
        geo_address_info: null,
        url: "https://lu.ma/full-url",
      },
    };
    const ev = parseLumaEntry(source, entry);
    expect(ev).not.toBeNull();
    expect(ev!.venue_name).toBeNull();
    expect(ev!.url).toBe("https://lu.ma/full-url");
  });

  it("returns null when required fields are missing", () => {
    expect(parseLumaEntry(source, { event: { name: "no id or start" } })).toBeNull();
  });
});
