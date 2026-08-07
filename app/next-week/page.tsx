import { RangeView } from "../components/RangeView";

export const dynamic = "force-dynamic";

const title = "Bay Area Tech & Startup Events Next Week — Ranked";
const description =
  "Next week's AI, startup, VC and founder events in the San Francisco Bay Area, scored and ranked so you can plan ahead.";

export const metadata = {
  title,
  description,
  alternates: { canonical: "/next-week" },
  openGraph: { title, description, url: "/next-week", type: "website" },
};

export default function Page() {
  return (
    <RangeView range="next-week" path="/next-week" seoTitle={title} seoDescription={description} />
  );
}
