// Event source links. A canonical event can be listed in several places (a Luma
// registration page AND the host's own site, say), so a deduped group carries one
// link per distinct destination — the digest and the web board both offer all of
// them rather than silently dropping the alternates.

/** Normalized event URL (host+path) so two rows pointing at the same page collapse
 *  (e.g. Cerebral Valley / Google linking to a Luma event). "" = not identifying. */
export function urlKeyOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "luma.com") host = "lu.ma"; // same platform, two hosts
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    // Ignore bare domain / listing roots — only real event paths identify an event.
    if (!path || path.length < 2) return "";
    return `${host}${path}`;
  } catch {
    return "";
  }
}

/** Human label for a link destination: the platform name, or "Official site" for
 *  an event's own domain (which is what a non-platform host almost always is). */
export function sourceLabel(url: string | null | undefined): string {
  if (!url) return "Source";
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (h === "lu.ma" || h === "luma.com") return "Luma";
    if (h.includes("eventbrite")) return "Eventbrite";
    if (h.includes("partiful")) return "Partiful";
    if (h.includes("supermomos")) return "Supermomos";
    if (h.includes("cerebralvalley")) return "Cerebral Valley";
    if (h.includes("meetup")) return "Meetup";
    return "Official site";
  } catch {
    return "Source";
  }
}

/** One destination for an event. `eventId` is the row that owns this URL — the
 *  click redirect resolves the target from it, never from a query string. */
export interface EventLink {
  eventId: string;
  url: string;
  label: string;
  isPrimary: boolean;
}

/** Build the deduped, ordered link list for a canonical group. Primary first,
 *  then alternates in a stable order.
 *
 *  Deduped by destination AND by label: two links to the same platform (two
 *  Eventbrite listings of one event, say) offer the reader no actual choice, so
 *  only the most authoritative of each platform is kept. What survives is a set
 *  of meaningfully different places to open — "Luma" vs "Official site". */
export function buildEventLinks(
  members: { id: string; url: string | null; isPrimary: boolean | null }[],
): EventLink[] {
  const out: EventLink[] = [];
  const seenUrl = new Set<string>();
  const seenLabel = new Set<string>();
  const ordered = [...members].sort((a, b) => {
    if (!!b.isPrimary !== !!a.isPrimary) return b.isPrimary ? 1 : -1;
    return a.id.localeCompare(b.id); // deterministic
  });
  for (const m of ordered) {
    const key = urlKeyOf(m.url);
    if (!key || seenUrl.has(key)) continue;
    const label = sourceLabel(m.url);
    if (seenLabel.has(label)) continue;
    seenUrl.add(key);
    seenLabel.add(label);
    out.push({ eventId: m.id, url: m.url!, label, isPrimary: !!m.isPrimary });
  }
  return out;
}
