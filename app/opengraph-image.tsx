import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "TLDR Events — Bay Area events, ranked by signal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Generated rather than shipped as a file so it always matches the site's look,
// and so there is a real preview when a link is shared into Telegram, Slack or X
// — previously these unfurled with no image at all.
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08080d",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 34, height: 34, background: "#7d5cff" }} />
          <div
            style={{
              color: "#f5f5fb",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 6,
            }}
          >
            TLDR EVENTS
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: "#f5f5fb",
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            The Bay Area&rsquo;s best events&mdash;
          </div>
          <div
            style={{
              color: "#7d5cff",
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            ranked by signal.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ color: "#a9a9c8", fontSize: 24, maxWidth: 720 }}>
            AI, startup and investor events, scored 0&ndash;10 and updated daily.
          </div>
          <div style={{ color: "#7d7da2", fontSize: 22, letterSpacing: 1 }}>
            tldrevents.com
          </div>
        </div>
      </div>
    ),
    size,
  );
}
