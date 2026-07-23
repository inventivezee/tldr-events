import type { Metadata } from "next";
import "./globals.css";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TLDR Events — Bay Area events for founders & investors",
    template: "%s · TLDR Events",
  },
  description:
    "The best Bay Area events for founders and investors — curated, scored, and summarized. Skip the firehose.",
  openGraph: {
    title: "TLDR Events",
    description:
      "The best Bay Area events for founders and investors — curated, scored, and summarized.",
    url: siteUrl,
    siteName: "TLDR Events",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "TLDR Events" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="container-tldr py-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
