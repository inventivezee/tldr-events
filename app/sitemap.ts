import type { MetadataRoute } from "next";
import { DateTime } from "luxon";
import { CALENDAR_DAYS } from "@/web/data";

export const dynamic = "force-dynamic";

const TZ = "America/Los_Angeles";

/**
 * The four horizons plus one URL per browsable day.
 *
 * The day pages are the long tail worth having indexed: "<city> tech events on
 * <date>" is a real query shape, and each day page answers exactly one of them.
 * Without them the sitemap listed four URLs for a site with thirty-two pages.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const now = new Date();
  const today = DateTime.now().setZone(TZ).startOf("day");

  const horizons: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/today`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/tomorrow`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/next-week`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];

  // Priority tapers with distance: the next few days are the useful ones, and a
  // date four weeks out is thin until the pipeline has gathered it.
  const days: MetadataRoute.Sitemap = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const d = today.plus({ days: i });
    return {
      url: `${base}/day/${d.toFormat("yyyy-MM-dd")}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: i < 7 ? 0.7 : 0.4,
    };
  });

  return [...horizons, ...days];
}
