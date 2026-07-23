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
  // Target is resolved from the DB in /api/click (never from the query string),
  // so we only pass identifiers here.
  return `${siteUrl()}/api/click?e=${encodeURIComponent(eventId)}&f=${encodeURIComponent(feedId)}&s=${surface}`;
}
