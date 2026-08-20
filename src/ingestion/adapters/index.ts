import type { SourceRow } from "@/db/schema";
import type { FetchFn } from "../types";
import { fetchLuma } from "./luma";
import { fetchCerebralValley } from "./cerebralValley";
import { fetchEventbrite } from "./eventbrite";
import { fetchPartiful } from "./partiful";
import { fetchGoogle } from "./google";
import { fetchSupermomos } from "./supermomos";
import { fetchEvion } from "./evion";
import { fetchSiteJsonLd } from "./siteJsonLd";

// Browser sources dispatch by source id; API sources by kind.
const BROWSER_BY_ID: Record<string, FetchFn> = {
  cerebral_valley: fetchCerebralValley,
  eventbrite_bay: fetchEventbrite,
  partiful_sf: fetchPartiful,
  google_sf: fetchGoogle,
  supermomos_sf: fetchSupermomos,
  evion_sf: fetchEvion,
};

export function adapterFor(source: SourceRow): FetchFn | null {
  if (source.kind === "luma_discover" || source.kind === "luma_calendar") {
    return fetchLuma;
  }
  // Standalone event sites that publish schema.org Event markup.
  if (source.kind === "site_jsonld") return fetchSiteJsonLd;
  if (source.kind === "browser") {
    // Allow a config override (config.adapter) for new browser sources.
    const override = (source.config as { adapter?: string })?.adapter;
    if (override && BROWSER_BY_ID[override]) return BROWSER_BY_ID[override];
    return BROWSER_BY_ID[source.id] ?? null;
  }
  return null;
}

export {
  fetchLuma,
  fetchCerebralValley,
  fetchEventbrite,
  fetchPartiful,
  fetchGoogle,
  fetchSupermomos,
  fetchEvion,
  fetchSiteJsonLd,
};
