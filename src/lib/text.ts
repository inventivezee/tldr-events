// Text normalization + fuzzy matching for dedup (PRD §10). No external deps.

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a venue name: drop common noise words after normalizeText. */
export function normalizeVenue(input: string | null | undefined): string {
  const base = normalizeText(input);
  if (!base) return "";
  const stop = new Set(["the", "at", "hq", "inc", "llc", "co"]);
  return base
    .split(" ")
    .filter((w) => w && !stop.has(w))
    .join(" ");
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeText(s).split(" ").filter(Boolean));
}

const TOKEN_MATCH = 85; // two tokens count as "the same" above this ratio
const CONTAINMENT_FLOOR = 60; // min overall sort-ratio before a subset match is trusted

/**
 * Token-set ratio in [0,100], robust to word order, extra qualifiers, and
 * singular/plural or minor spelling differences (fuzzy token matching).
 * Combines a token-sort ratio with a containment signal, so a title that is
 * essentially a subset/extension of another scores high.
 * "AI Founder Dinner" vs "AI Founders' Dinner @ SoMa" → ≥90.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = [...tokenSet(a)];
  const tb = [...tokenSet(b)];
  if (ta.length === 0 && tb.length === 0) return 100;
  if (ta.length === 0 || tb.length === 0) return 0;

  // Token-sort ratio: sorted tokens joined, straight similarity.
  const sortRatio = ratio(ta.slice().sort().join(" "), tb.slice().sort().join(" "));

  // Containment: fraction of the smaller set's tokens with a fuzzy match in the larger.
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let matched = 0;
  for (const t of small) {
    if (large.some((u) => u === t || ratio(t, u) >= TOKEN_MATCH)) matched++;
  }
  const containment = (matched / small.length) * 100;

  // Containment alone (100 whenever the smaller title is a subset) over-merges a
  // short/generic title into an unrelated longer one. Only trust it when the two
  // titles are also reasonably similar OVERALL (sort ratio floor) — i.e. the
  // larger title adds only a few qualifier tokens, not a whole different subject.
  const containmentTrusted = sortRatio >= CONTAINMENT_FLOOR ? containment : 0;

  return Math.round(Math.max(sortRatio, containmentTrusted));
}

/** Levenshtein similarity ratio in [0,100]. */
export function ratio(a: string, b: string): number {
  if (a === b) return 100;
  if (!a.length || !b.length) return 0;
  const dist = levenshtein(a, b);
  return (1 - dist / Math.max(a.length, b.length)) * 100;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1, // deletion
        dp[j - 1] + 1, // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/** Normalize a person name for the `people` dedup key. */
export function normalizeName(name: string | null | undefined): string {
  return normalizeText(name)
    .split(" ")
    .filter((w) => w.length > 1 || /\d/.test(w))
    .join(" ");
}

/** Haversine distance in meters between two lat/lng points. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
