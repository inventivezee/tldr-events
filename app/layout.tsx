import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  robots: { index: true, follow: true },
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
      <body>{children}</body>
    </html>
  );
}
