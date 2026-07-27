import { describe, it, expect } from "vitest";
import { renderDigestMessage } from "@/digest/render";
import type { DeliveryEvent } from "@/digest/query";
import type { FeedRow } from "@/db/schema";
import type { Tier } from "@/types";

const feed = { id: "bay_founder" } as unknown as FeedRow;
const TZ = "America/Los_Angeles";

function ev(i: number, tier: Tier, title = `Event ${i}`): DeliveryEvent {
  return {
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    title,
    url: `https://lu.ma/evt${i}`,
    startsAt: new Date(`2026-07-2${(i % 9) + 1}T02:00:00Z`),
    city: "San Francisco",
    venueName: "Frontier Tower",
    guestCount: 40,
    score: tier === "dont_miss" ? 8.7 : 6.5,
    tier,
    tldr: "SUMMARY-SHOULD-NOT-APPEAR",
    categoryTag: "ai",
    relevant: true,
    notable: [],
    speakerNames: ["Jane Doe", "John Smith"],
    links: [
      {
        eventId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        url: `https://lu.ma/evt${i}`,
        label: "Luma",
        isPrimary: true,
      },
    ],
  };
}

describe("renderDigestMessage", () => {
  it("is a single message, tier-grouped, with direct links and no summary/buttons", () => {
    const msg = renderDigestMessage(feed, [ev(1, "strong"), ev(2, "dont_miss")], "weekly", TZ);
    expect(typeof msg).toBe("string");
    expect(msg.indexOf("Must Attend")).toBeLessThan(msg.indexOf("Strong Picks"));
    expect(msg).toContain('href="https://lu.ma/evt2"'); // direct source link
    expect(msg).not.toContain("/api/click"); // not the redirect
    expect(msg).not.toContain("SUMMARY-SHOULD-NOT-APPEAR"); // no TL;DR line
    expect(msg).toContain("🎤 Jane Doe");
    expect(msg.length).toBeLessThanOrEqual(4096);
  });

  it("emits a single message under the 4096 limit even for many events", () => {
    const many = Array.from({ length: 150 }, (_, i) => ev(i, "strong"));
    const msg = renderDigestMessage(feed, many, "weekly", TZ);
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(msg).toContain("more at");
  });

  it("empty daily → no message; empty weekly → quiet-week note", () => {
    expect(renderDigestMessage(feed, [], "daily", TZ)).toBe("");
    expect(renderDigestMessage(feed, [], "weekly", TZ).toLowerCase()).toContain("quiet week");
  });

  it("escapes HTML in titles", () => {
    const msg = renderDigestMessage(feed, [ev(1, "dont_miss", "A <b>hack</b> & co")], "weekly", TZ);
    expect(msg).toContain("&lt;b&gt;");
    expect(msg).toContain("&amp;");
  });

  it("uses the category emoji as the bullet instead of a dot", () => {
    const msg = renderDigestMessage(feed, [ev(1, "dont_miss")], "weekly", TZ);
    expect(msg).toContain("🤖 <a href="); // ai → 🤖 leads the entry
    expect(msg).not.toContain("• <a href=");
  });

  it("offers every source link for a deduped multi-source event", () => {
    const e = ev(1, "dont_miss", "Agentic AI Summit");
    e.links = [
      { eventId: "a", url: "https://lu.ma/agentic-ai-summit", label: "Luma", isPrimary: true },
      {
        eventId: "b",
        url: "https://rdi.berkeley.edu/events/agentic-ai-summit-2026",
        label: "Official site",
        isPrimary: false,
      },
    ];
    const msg = renderDigestMessage(feed, [e], "weekly", TZ);
    // Title links to the primary; the alternate is offered on the meta line.
    expect(msg).toContain('<a href="https://lu.ma/agentic-ai-summit">Agentic AI Summit</a>');
    expect(msg).toContain('<a href="https://rdi.berkeley.edu/events/agentic-ai-summit-2026">Official site</a>');
  });
});
