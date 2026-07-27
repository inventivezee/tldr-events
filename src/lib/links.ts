// Outbound link helpers. All event clicks (Telegram + Web) route through
// /api/click, which logs to click_events then 302-redirects to the source →
// unified engagement metric (PRD §6, §12, §13).

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function clickUrl(
  eventId: string,
  feedId: string,
  surface: "telegram" | "web",
): string {
  // Absolute URL — needed for Telegram (external context). Target is resolved
  // from the DB in /api/click (never from the query string).
  return `${siteUrl()}${clickPath(eventId, feedId, surface)}`;
}

/** Relative click path for the website — works on any domain without depending
 *  on NEXT_PUBLIC_SITE_URL being set correctly in the deploy. */
export function clickPath(
  eventId: string,
  feedId: string,
  surface: "telegram" | "web",
  altEventId?: string,
): string {
  // `alt` picks an alternate source link belonging to the SAME canonical event;
  // /api/click validates it against the canonical group before redirecting.
  const alt =
    altEventId && altEventId !== eventId ? `&alt=${encodeURIComponent(altEventId)}` : "";
  return `/api/click?e=${encodeURIComponent(eventId)}&f=${encodeURIComponent(feedId)}&s=${surface}${alt}`;
}
