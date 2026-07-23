import { Suspense } from "react";
import { HeaderNav } from "./HeaderNav";
import { FollowButton } from "./FollowButton";

export function Header() {
  return (
    <header style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="container-tldr flex flex-wrap items-center justify-between gap-3 py-4">
        <Suspense fallback={<span className="text-lg font-bold tracking-tight">TLDR Events</span>}>
          <HeaderNav />
        </Suspense>
        <FollowButton compact />
      </div>
    </header>
  );
}
