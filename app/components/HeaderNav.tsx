"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const VIEWS = [
  { href: "/today", label: "Today" },
  { href: "/tomorrow", label: "Tomorrow" },
  { href: "/", label: "This Week" },
  { href: "/next-week", label: "Next Week" },
];

export function HeaderNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const isAll = params.get("all") === "1";

  // View links preserve the current mode (TLDR vs All) but reset niche/tier.
  const viewHref = (base: string) => (isAll ? `${base}?all=1` : base);

  // Mode links stay on the current view and preserve niche/tier filters.
  const modeHref = (all: boolean) => {
    const q = new URLSearchParams();
    if (all) q.set("all", "1");
    const cat = params.get("cat");
    const tier = params.get("tier");
    if (cat) q.set("cat", cat);
    if (tier) q.set("tier", tier);
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <details className="relative">
        <summary className="flex cursor-pointer items-center gap-1 text-lg font-bold tracking-tight">
          {isAll ? "All Events" : "TLDR Events"}
          <span aria-hidden style={{ color: "var(--muted)" }}>▾</span>
        </summary>
        <div
          className="absolute left-0 z-20 mt-2 rounded-lg py-1"
          style={{ background: "var(--panel)", border: "1px solid var(--border)", minWidth: 200 }}
        >
          <Link href={modeHref(false)} className="block px-4 py-2 text-sm hover:opacity-80">
            TLDR Events <span style={{ color: "var(--muted)" }}>· curated</span>
          </Link>
          <Link href={modeHref(true)} className="block px-4 py-2 text-sm hover:opacity-80">
            All Events <span style={{ color: "var(--muted)" }}>· unfiltered</span>
          </Link>
        </div>
      </details>

      <nav className="flex flex-wrap items-center gap-4 text-sm">
        {VIEWS.map((v) => {
          const active = pathname === v.href;
          return (
            <Link
              key={v.href}
              href={viewHref(v.href)}
              className="hover:opacity-80"
              style={{ color: active ? "var(--text)" : "var(--muted)", fontWeight: active ? 600 : 400 }}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
