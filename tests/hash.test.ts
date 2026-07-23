import { describe, it, expect } from "vitest";
import { contentHash } from "@/lib/hash";

const base = {
  title: "AI Founders Dinner",
  startsAt: new Date("2026-07-23T01:00:00Z"),
  endsAt: null,
  status: "active",
  venueName: "Frontier Tower",
  city: "San Francisco",
  description: "A small dinner.",
  guestCount: 24,
  hosts: [{ name: "Jane Doe" }],
  speakers: [{ name: "Alice Smith" }, { name: "Bob Jones" }],
};

describe("contentHash", () => {
  it("is stable for the same instant (different Date object)", () => {
    const a = contentHash(base);
    const b = contentHash({ ...base, startsAt: new Date("2026-07-23T01:00:00.000Z") });
    expect(a).toBe(b);
  });
  it("is order-independent for speakers/hosts", () => {
    const a = contentHash(base);
    const b = contentHash({
      ...base,
      speakers: [{ name: "Bob Jones" }, { name: "Alice Smith" }],
    });
    expect(a).toBe(b);
  });
  it("changes when the real start time changes", () => {
    const a = contentHash(base);
    const b = contentHash({ ...base, startsAt: new Date("2026-07-23T02:00:00Z") });
    expect(a).not.toBe(b);
  });
  it("changes when the status changes", () => {
    expect(contentHash(base)).not.toBe(contentHash({ ...base, status: "canceled" }));
  });
});
