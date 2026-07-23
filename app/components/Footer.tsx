export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)" }} className="mt-12">
      <div
        className="container-tldr py-6 text-sm"
        style={{ color: "var(--muted)" }}
      >
        <p>
          <strong style={{ color: "var(--text)" }}>TLDR Events</strong> — the best
          Bay Area events for founders &amp; investors. Curated, scored, and
          summarized. Skip the firehose.
        </p>
        <p className="mt-2">
          Events link out to their source. We show short snippets and attribute the
          source; we don&apos;t sell tickets or collect RSVPs.
        </p>
      </div>
    </footer>
  );
}
