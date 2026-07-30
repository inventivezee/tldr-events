import { describe, it, expect } from "vitest";
import { descriptionFromHtml } from "@/ingestion/luma-detail";

/** Shaped like a real lu.ma page: a non-Event block first, then the Event. */
const page = (description: string, extra = "") => `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Luma"}</script>
${extra}
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Event",
  name: "OpenAI Codex Community Meetup",
  description,
})}</script>
</head><body>…</body></html>`;

const billing = `Join us in Sports Basement for an evening designed for beginners and experienced users.

Invited Speaker:
1) Yufei Zhao, Member of Technical Staff, OpenAI, Stanford University
2) Karan Raina, Co-Founder & CTO, HyperProbe (YC S26), Georgia Tech
3) Serena Pei, Co-Founder & CTO, Palette (YC S26), MIT`;

describe("descriptionFromHtml", () => {
  it("returns the Event block's description, not another block's", () => {
    const out = descriptionFromHtml(page(billing));
    expect(out).toContain("Invited Speaker");
    expect(out).toContain("Yufei Zhao");
    expect(out).not.toContain("Luma"); // the WebSite block
  });

  it("survives a malformed JSON-LD block earlier in the page", () => {
    const broken = '<script type="application/ld+json">{ not json )</script>';
    expect(descriptionFromHtml(page(billing, broken))).toContain("Karan Raina");
  });

  it("ignores teaser-length and missing descriptions", () => {
    expect(descriptionFromHtml(page("Too short"))).toBeNull();
    expect(descriptionFromHtml("<html><body>no ld+json</body></html>")).toBeNull();
    expect(
      descriptionFromHtml(
        '<script type="application/ld+json">{"@type":"Event","name":"x"}</script>',
      ),
    ).toBeNull();
  });

  it("caps very long descriptions", () => {
    const out = descriptionFromHtml(page("y".repeat(9000)));
    expect(out?.length).toBe(6000);
  });
});
