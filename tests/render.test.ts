import { describe, it, expect } from "vitest";
import { renderDigestMessages } from "@/digest/render";
import type { DeliveryEvent } from "@/digest/query";
import type { FeedRow } from "@/db/schema";
import type { Tier } from "@/types";

const feed = { id: "bay_founder" } as unknown as FeedRow;
const TZ = "America/Los_Angeles";

function ev(i: number, tier: Tier, title = `Event ${i}`): DeliveryEvent {
  return {
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    title,
    url: "https://lu.ma/x",
    startsAt: new Date(`2026-07-2${(i % 9) + 1}T02:00:00Z`),
    city: "San Francisco",
    venueName: "Frontier Tower",
    guestCount: 40,
    score: tier === "dont_miss" ? 8.7 : 6.5,
    tier,
    tldr: "A high-signal room worth crossing town for.",
    categoryTag: "ai",
    relevant: true,
    notable: [{ name: "Jane Doe", note: "Partner at Sequoia", prominence: 9, title: "Partner", company: "Sequoia" }],
  };
}

describe("renderDigestMessages", () => {
  it("groups tiers with Don't Miss first and one button per event", () => {
    const events = [ev(1, "strong"), ev(2, "dont_miss")];
    const chunks = renderDigestMessages(feed, events, "daily", TZ);
    const html = chunks.map((c) => c.html).join("\n");
    expect(html.indexOf("Don't Miss")).toBeLessThan(html.indexOf("Strong Pick"));
    const buttons = chunks.reduce((n, c) => n + c.buttons.length, 0);
    expect(buttons).toBe(2);
  });

  it("emits a quiet-week note for an empty weekly digest", () => {
    const chunks = renderDigestMessages(feed, [], "weekly", TZ);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].html.toLowerCase()).toContain("quiet week");
  });

  it("emits nothing for an empty daily digest", () => {
    expect(renderDigestMessages(feed, [], "daily", TZ)).toHaveLength(0);
  });

  it("escapes HTML in titles", () => {
    const chunks = renderDigestMessages(feed, [ev(1, "dont_miss", "A <b>hack</b> & co")], "daily", TZ);
    const html = chunks.map((c) => c.html).join("");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
  });

  it("splits long digests under the 4096-char limit", () => {
    const events = Array.from({ length: 80 }, (_, i) => ev(i, "dont_miss"));
    const chunks = renderDigestMessages(feed, events, "weekly", TZ);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.html.length).toBeLessThanOrEqual(4096);
  });
});
