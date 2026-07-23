import Link from "next/link";
import { FollowButton } from "./FollowButton";

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/tomorrow", label: "Tomorrow" },
  { href: "/", label: "This Week" },
  { href: "/next-week", label: "Next Week" },
];

export function Header() {
  return (
    <header style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="container-tldr flex flex-wrap items-center justify-between gap-3 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">TLDR Events</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:opacity-80" style={{ color: "var(--muted)" }}>
              {n.label}
            </Link>
          ))}
          <FollowButton compact />
        </nav>
      </div>
    </header>
  );
}
