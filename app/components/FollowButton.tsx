import { telegramFollowUrl } from "@/web/data";

export function FollowButton({ compact = false }: { compact?: boolean }) {
  const url = telegramFollowUrl();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
      style={{ background: "var(--accent)", color: "#0b0c10" }}
    >
      <span aria-hidden>✈️</span>
      {compact ? "Follow" : "Follow on Telegram"}
    </a>
  );
}
