import { RangeView } from "./components/RangeView";

export const dynamic = "force-dynamic";

// The root page shares a segment with the root layout, so the layout's title
// TEMPLATE does not apply here — this title has to stand on its own, and it's
// the site's most-linked page.
const title = "Bay Area Tech & Startup Events This Week — Ranked | TLDR Events";
const description =
  "Every AI, startup, VC and founder event in the San Francisco Bay Area this week, scored 0–10 and ranked by signal. Updated daily from Luma, Eventbrite, Partiful and more.";

export const metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, url: "/", type: "website" },
};

export default function Page() {
  return (
    <RangeView range="this-week" path="/" seoTitle={title} seoDescription={description} />
  );
}
