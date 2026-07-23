"use client";
import { useEffect, useState } from "react";

/**
 * Renders the event time. Server-renders the PT default (SEO-stable), then
 * re-localizes to the visitor's timezone after mount (PRD §13 "visitor-localized,
 * PT default").
 */
export function EventTime({ iso, ptLabel }: { iso: string; ptLabel: string }) {
  const [label, setLabel] = useState(ptLabel);

  useEffect(() => {
    try {
      const d = new Date(iso);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const fmt = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      const local = fmt.format(d);
      if (tz && tz !== "America/Los_Angeles") setLabel(local);
    } catch {
      /* keep PT default */
    }
  }, [iso]);

  return <span suppressHydrationWarning>{label}</span>;
}
