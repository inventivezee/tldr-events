// Cron endpoint auth. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// Also accepts the x-cron-secret header, and a ?secret= query param for
// local/manual triggering ONLY (query params land in access logs, so it's
// disabled on Vercel).
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed in any deployed environment; only allow when running locally
    // (no CRON_SECRET set on a dev machine). On Vercel, a missing secret must
    // NOT silently expose the cron endpoints.
    return process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production";
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  // Query-param secret only outside production — Vercel Cron uses the header, so
  // this is purely a manual/local convenience and shouldn't leak into prod logs.
  if (process.env.VERCEL !== "1") {
    try {
      const url = new URL(req.url);
      if (url.searchParams.get("secret") === secret) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
