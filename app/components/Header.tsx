import Link from "next/link";
import { FollowButton } from "./FollowButton";

export function Header() {
  return (
    <header style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="container-tldr flex items-center justify-between gap-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">TLDR Events</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:opacity-80" style={{ color: "var(--muted)" }}>
            This Week
          </Link>
          <Link href="/next-week" className="hover:opacity-80" style={{ color: "var(--muted)" }}>
            Next Week
          </Link>
          <FollowButton compact />
        </nav>
      </div>
    </header>
  );
}
