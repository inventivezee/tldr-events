// Milestone 0 labeled evaluation set (PRD §11.2 "Rubric development", §18 M0).
// The rubric is measured against this set — never tuned on vibes. These starter
// entries are ILLUSTRATIVE and synthetic; the curator replaces/expands them to
// 30–50 REAL Bay Area events, each labeled from a founder/investor's POV:
//   'dont_miss' (≥8) · 'strong' (6–7.9) · 'noise' (<6).
import type { ScoringPerson } from "@/scoring/scorer";

export type Label = "dont_miss" | "strong" | "noise";

export interface LabeledEvent {
  id: string;
  title: string;
  description: string;
  city: string;
  guestCount?: number;
  categories?: string[];
  people?: ScoringPerson[];
  label: Label;
  note?: string; // why the curator labeled it this way
}

export const LABELED_SET: LabeledEvent[] = [
  {
    id: "l1",
    title: "AI Infra Founders Dinner (invite-only)",
    description:
      "Small dinner for founders building AI infrastructure. Curated table, off the record.",
    city: "San Francisco",
    guestCount: 24,
    categories: ["ai", "founder_investor"],
    people: [
      { name: "Partner A", role: "host", company: "a16z", title: "General Partner", note: "GP at a16z", prominence: 9 },
      { name: "Founder B", role: "speaker", company: "Series-A AI infra co", note: "Founder of a fast-growing AI-infra startup", prominence: 8 },
    ],
    label: "dont_miss",
    note: "Elite small room, top-fund partner + serious founders.",
  },
  {
    id: "l2",
    title: "YC-style Demo Day: Winter Batch",
    description: "Founders pitch to a room of investors. Demos + Q&A.",
    city: "Mountain View",
    guestCount: 300,
    categories: ["founder_investor"],
    people: [{ name: "Managing Partner C", role: "host", company: "Top Seed Fund", prominence: 8, note: "Leads a well-known seed fund" }],
    label: "dont_miss",
    note: "Demo day with real investor density.",
  },
  {
    id: "l3",
    title: "Bay Area AI Hackathon (48h, prizes)",
    description: "Build with the latest models. Great place to meet a co-founder. Sponsored tracks.",
    city: "San Francisco",
    guestCount: 180,
    categories: ["ai", "hackathon"],
    label: "strong",
    note: "Prime co-founder venue; not elite but high value.",
  },
  {
    id: "l4",
    title: "Fintech Founders & Operators Happy Hour",
    description: "Casual drinks for people building in payments and fintech.",
    city: "San Francisco",
    guestCount: 60,
    categories: ["fintech_blockchain", "founder_investor"],
    label: "strong",
    note: "Relevant crowd, decent but not curated.",
  },
  {
    id: "l5",
    title: "Intro to Python for Beginners (paid course)",
    description: "Learn Python basics. No experience needed. $99 ticket.",
    city: "San Jose",
    guestCount: 40,
    categories: [],
    label: "noise",
    note: "Beginner/educational, no room signal.",
  },
  {
    id: "l6",
    title: "Networking Mixer @ Downtown Bar",
    description: "Meet new people! Open networking, cash bar. All welcome.",
    city: "Oakland",
    categories: [],
    label: "noise",
    note: "Anonymous mixer, no named hosts/guests.",
  },
  {
    id: "l7",
    title: "Longevity Biotech Investor Roundtable",
    description: "Closed-door discussion on longevity investing with LPs and GPs.",
    city: "Palo Alto",
    guestCount: 30,
    categories: ["longevity", "founder_investor"],
    people: [{ name: "Investor D", role: "host", company: "Longevity Fund", title: "Partner", prominence: 8, note: "Partner at a longevity-focused fund" }],
    label: "dont_miss",
    note: "Rare, high-signal investor room in a target niche.",
  },
  {
    id: "l8",
    title: "Web3 Buildathon Kickoff",
    description: "Kick off a weekend of building onchain apps. Mentors on site.",
    city: "San Francisco",
    guestCount: 120,
    categories: ["fintech_blockchain", "hackathon"],
    label: "strong",
    note: "Builder-dense hackathon, relevant niche.",
  },
  {
    id: "l9",
    title: "Generic SaaS Webinar (virtual only)",
    description: "Online webinar about SaaS growth tactics. Zoom link on registration.",
    city: "Virtual",
    categories: ["founder_investor"],
    label: "noise",
    note: "Virtual, passive, no room.",
  },
  {
    id: "l10",
    title: "Founders + VCs Rooftop Dinner",
    description: "Intimate dinner pairing founders with active early-stage investors.",
    city: "San Francisco",
    guestCount: 28,
    categories: ["founder_investor"],
    people: [
      { name: "Investor E", role: "host", company: "Seed Fund X", title: "Partner", prominence: 7, note: "Active seed investor" },
      { name: "Founder F", role: "speaker", company: "Growth-stage startup", prominence: 7, note: "Repeat founder" },
    ],
    label: "dont_miss",
    note: "Curated founder/investor pairing dinner.",
  },
  {
    id: "l11",
    title: "AI Meetup: Lightning Talks",
    description: "Community lightning talks on ML topics. Open to all.",
    city: "Sunnyvale",
    guestCount: 90,
    categories: ["ai"],
    label: "strong",
    note: "Relevant, some signal, but broad/open.",
  },
  {
    id: "l12",
    title: "MLM Business Opportunity Seminar",
    description: "Discover a life-changing business opportunity. Free entry.",
    city: "San Jose",
    categories: [],
    label: "noise",
    note: "Sales/MLM — should score near zero.",
  },
];
