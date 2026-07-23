// Adapter contract (PRD §9.2). Each source implements `fetch` returning
// NormalizedEvent[]; the runner normalizes + upserts.
import type { NormalizedEvent } from "@/types";
import type { SourceRow } from "@/db/schema";
import type { BrowserSession } from "@/lib/browserbase";

export interface FetchContext {
  /** Shared browser session for `browser`-kind sources (undefined for HTTP sources). */
  session?: BrowserSession;
  /** Run timestamp (UTC) for query construction / "this week" resolution. */
  now: Date;
}

export type FetchFn = (
  source: SourceRow,
  ctx: FetchContext,
) => Promise<NormalizedEvent[]>;

/** Sources of kind 'browser' need a browser session. */
export function needsBrowser(source: SourceRow): boolean {
  return source.kind === "browser";
}
