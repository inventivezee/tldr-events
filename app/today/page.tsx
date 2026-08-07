import { RangeView } from "../components/RangeView";

export const dynamic = "force-dynamic";

const title = "Tech & Startup Events in San Francisco Today — Ranked";
const description =
  "What's on today in the Bay Area for founders and investors: AI, startup, VC and hackathon events, each scored 0–10 and ranked by signal.";

export const metadata = {
  title,
  description,
  alternates: { canonical: "/today" },
  openGraph: { title, description, url: "/today", type: "website" },
};

export default function Page() {
  return (
    <RangeView range="today" path="/today" seoTitle={title} seoDescription={description} />
  );
}
