import type { Metadata, Viewport } from "next";
import "./globals.css";
import { siteJsonLd, jsonLdScript } from "@/web/structured-data";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const description =
  "The best Bay Area events for founders and investors — curated, scored, and ranked by signal. Skip the firehose.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TLDR Events — Bay Area events, ranked by signal",
    template: "%s · TLDR Events",
  },
  description,
  applicationName: "TLDR Events",
  openGraph: {
    type: "website",
    siteName: "TLDR Events",
    title: "TLDR Events",
    description,
    url: siteUrl,
  },
  twitter: { card: "summary_large_image", title: "TLDR Events", description },
  alternates: { canonical: "/" },
  keywords: [
    "Bay Area tech events",
    "San Francisco startup events",
    "AI events San Francisco",
    "SF founder events",
    "Bay Area VC events",
    "tech meetups San Francisco",
  ],
  robots: {
    index: true,
    follow: true,
    // Let search engines show a full snippet and a large preview: the whole
    // point is for an events list to be summarised in the result.
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#08080d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(siteJsonLd(siteUrl)) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
