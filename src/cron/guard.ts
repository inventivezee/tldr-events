// Cron endpoint auth. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// Also accepts ?secret= or x-cron-secret for manual/local triggering.
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
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") === secret) return true;
  } catch {
    /* ignore */
  }
  return false;
}
