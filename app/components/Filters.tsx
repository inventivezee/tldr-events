import Link from "next/link";
import type { Tier } from "@/types";
import { categoryLabel, TIER_ICON, TIER_LABEL } from "@/scoring/tiers";

function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--accent)" : "var(--panel)",
    color: active ? "#0b0c10" : "var(--muted)",
    border: "1px solid var(--border)",
  };
}

function href(basePath: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function Filters({
  basePath,
  categories,
  cat,
  tier,
  all,
}: {
  basePath: string;
  categories: string[];
  cat?: string;
  tier?: Tier;
  all?: boolean;
}) {
  // In "All events" mode, also offer the 👀 Worth-a-Look tier (hidden by the
  // quality gate in TLDR mode). Preserve the `all` flag across every filter link.
  const tiers: Tier[] = all ? ["dont_miss", "strong", "radar"] : ["dont_miss", "strong"];
  const mode = all ? { all: "1" } : {};

  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link
          href={href(basePath, { ...mode, tier })}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={chipStyle(!cat)}
        >
          All niches
        </Link>
        {categories.map((c) => (
          <Link
            key={c}
            href={href(basePath, { ...mode, cat: c, tier })}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={chipStyle(cat === c)}
          >
            {categoryLabel(c)}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={href(basePath, { ...mode, cat })}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={chipStyle(!tier)}
        >
          All tiers
        </Link>
        {tiers.map((t) => (
          <Link
            key={t}
            href={href(basePath, { ...mode, cat, tier: t })}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={chipStyle(tier === t)}
          >
            {TIER_ICON[t]} {TIER_LABEL[t]}
          </Link>
        ))}
      </div>
    </div>
  );
}
