// Is a place string in the SF Bay Area?
//
// Adapters stamp every row with their SOURCE's region, which is fine for a
// place-scoped feed but wrong for anything global: a Luma calendar we follow for
// its SF events also runs "ClawCamp Nairobi", and an aggregator's listing order
// depends on where the scraper's proxy exited. Without a check those land in the
// feed labelled SF Bay.
const BAY_AREA =
  /(bay area|san francisco|^sf$|\bsf\b|oakland|berkeley|palo alto|menlo park|mountain view|san jose|santa clara|sunnyvale|redwood city|stanford|cupertino|los altos|emeryville|alameda|hayward|fremont|burlingame|san mateo|foster city|milpitas|campbell|saratoga|los gatos|belmont|daly city|richmond, ca|marin|sausalito|south san francisco|brisbane|colma|pacifica|union city|newark, ca|walnut creek|pleasanton|dublin, ca|livermore|san carlos|atherton|woodside|portola valley|half moon bay|san bruno|millbrae|silicon valley|mtv\b)/i;

/** True when the text names a Bay Area place. */
export function isBayArea(text: string | null | undefined): boolean {
  return !!text && BAY_AREA.test(text);
}

/**
 * Should an event from a global source be kept for a Bay Area feed?
 *
 * Fails OPEN on missing location: plenty of legitimate listings omit a city, and
 * dropping those would lose more than it saves. Only a location we can read AND
 * that is clearly somewhere else is rejected.
 */
export function keepForBayArea(...placeFields: (string | null | undefined)[]): boolean {
  const known = placeFields.filter((f): f is string => !!f && f.trim().length > 0);
  if (known.length === 0) return true;
  return known.some((f) => isBayArea(f));
}
