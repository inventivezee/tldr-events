// schema.org JSON-LD for the board pages.
//
// This is the highest-leverage thing on the site for both audiences:
//   * Google reads Event markup for event rich results, which is how an events
//     page earns a listing rather than a plain blue link.
//   * Answer engines (ChatGPT/Perplexity/Claude search, AI Overviews) parse
//     JSON-LD far more reliably than they infer meaning from styled markup — our
//     event cards are a grid of <span>s to a machine, but unambiguous here.
//
// Everything emitted must be visible on the page: Google penalises markup that
// describes content a user can't see, and inventing detail would mislead the
// models we're trying to inform.
import type { BoardEvent } from "./board-types";

const ORG_NAME = "TLDR Events";

function absolute(base: string, path: string): string {
  return path.startsWith("http") ? path : `${base.replace(/\/$/, "")}${path}`;
}

/** Best available public URL for an event: its source page, else the board page. */
function eventUrl(e: BoardEvent, pageUrl: string): string {
  return e.sourceUrl ?? pageUrl;
}

/**
 * One schema.org Event. Location is deliberately loose — sources give us a city,
 * sometimes a venue, rarely a full address — so we emit what we actually hold
 * rather than fabricating a postal address to satisfy a validator.
 */
function eventNode(e: BoardEvent, base: string, pageUrl: string) {
  const placeName = e.venue ?? e.city ?? "San Francisco Bay Area";
  const node: Record<string, unknown> = {
    "@type": "Event",
    name: e.title,
    startDate: e.startsAt,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: eventUrl(e, pageUrl),
    location: {
      "@type": "Place",
      name: placeName,
      address: {
        "@type": "PostalAddress",
        addressLocality: e.city ?? "San Francisco",
        addressRegion: "CA",
        addressCountry: "US",
      },
    },
  };
  if (e.endsAt) node.endDate = e.endsAt;
  if (e.tldr) node.description = e.tldr;
  // The curated score, expressed in a vocabulary crawlers understand.
  node.aggregateRating = {
    "@type": "AggregateRating",
    ratingValue: e.score.toFixed(1),
    bestRating: "10",
    worstRating: "0",
    ratingCount: 1,
    author: { "@type": "Organization", name: ORG_NAME },
  };
  return node;
}

/**
 * The page's graph: the ranked list of events, plus who publishes it.
 *
 * ItemList carries the ORDER, which is the product's actual claim — these events
 * ranked this way for this day — and is what lets an answer engine say "the top
 * event on Thursday is X" rather than listing whatever it scraped first.
 */
export function boardJsonLd(opts: {
  base: string;
  path: string;
  title: string;
  description: string;
  events: BoardEvent[];
  /** Max events to describe; the rest are on the page but not worth the bytes. */
  limit?: number;
}) {
  const pageUrl = absolute(opts.base, opts.path);
  const events = opts.events.slice(0, opts.limit ?? 40);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#page`,
        url: pageUrl,
        name: opts.title,
        description: opts.description,
        isPartOf: { "@id": `${opts.base}#website` },
        about: {
          "@type": "Thing",
          name: "Bay Area startup, AI and investor events",
        },
        mainEntity: {
          "@type": "ItemList",
          name: opts.title,
          numberOfItems: events.length,
          itemListOrder: "https://schema.org/ItemListOrderDescending",
          itemListElement: events.map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: eventNode(e, opts.base, pageUrl),
          })),
        },
      },
    ],
  };
}

/** Site-level identity, emitted once in the root layout. */
export function siteJsonLd(base: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}#website`,
        url: base,
        name: ORG_NAME,
        description:
          "Curated, scored and ranked tech, startup and investor events in the San Francisco Bay Area.",
        publisher: { "@id": `${base}#org` },
        inLanguage: "en-US",
      },
      {
        "@type": "Organization",
        "@id": `${base}#org`,
        name: ORG_NAME,
        url: base,
        description:
          "TLDR Events tracks Bay Area tech and startup events across Luma, Eventbrite, Partiful and other platforms, then scores each one for founders and investors.",
      },
    ],
  };
}

/** Render a JSON-LD script tag's inner content, safe for embedding in HTML. */
export function jsonLdScript(data: unknown): string {
  // "<" is escaped so a title containing markup can't close the script element.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
