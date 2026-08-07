import type { MetadataRoute } from "next";

/**
 * Crawling policy.
 *
 * The AI crawlers are named explicitly rather than left to the wildcard. Some
 * operators check for their own user-agent before trusting a permissive default,
 * and being explicit means a later tightening of the wildcard can't silently cut
 * off the answer engines we WANT indexing this — an events list is exactly the
 * kind of thing people ask an assistant about.
 */
const AI_CRAWLERS = [
  "GPTBot", // OpenAI training/indexing
  "OAI-SearchBot", // ChatGPT search
  "ChatGPT-User", // ChatGPT browsing on a user's behalf
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended", // Gemini / AI Overviews grounding
  "Applebot",
  "Applebot-Extended",
  "Bingbot",
  "DuckDuckBot",
  "CCBot", // Common Crawl — feeds many models
  "Amazonbot",
  "meta-externalagent",
  "cohere-ai",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return {
    rules: [
      // /api/ is machinery (cron, click redirects, the Telegram webhook) — no
      // content, and the click endpoint would look like a redirect farm.
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: ["/api/"],
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
