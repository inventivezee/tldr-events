// First-pass signal (PRD §11.1). Cheap keyword + signal heuristic, baseline
// 3/10. Used ONLY to prioritize the scoring queue and as a fallback signal —
// never as the primary score for delivered content (that is the editorial model).
import type { EventRow } from "@/db/schema";
import type { PersonRef } from "@/types";

export function heuristicScore(e: EventRow): number {
  let score = 3;
  const text = `${e.title} ${e.description ?? ""}`.toLowerCase();

  // Event-type signal.
  if (/(demo day|pitch|founder dinner|investor|vc|hackathon|lp |gp |accelerator)/.test(text))
    score += 2;
  if (/(mixer|networking)/.test(text) && !/founder|investor/.test(text)) score -= 1;
  if (/(webinar|course|101|beginner|virtual only|online only)/.test(text)) score -= 1.5;

  // Guest count signal.
  const gc = e.guestCount ?? 0;
  if (gc >= 200) score += 1.5;
  else if (gc >= 50) score += 1;
  else if (gc > 0 && gc < 10) score += 0.5;

  // Named people present at all.
  const speakers = (e.speakers ?? []) as PersonRef[];
  const hosts = (e.hosts ?? []) as PersonRef[];
  if (speakers.length + hosts.length >= 3) score += 1;
  else if (speakers.length + hosts.length >= 1) score += 0.5;

  // Niche relevance.
  if ((e.categories ?? []).length > 0) score += 0.5;

  return Math.max(0, Math.min(10, score));
}
