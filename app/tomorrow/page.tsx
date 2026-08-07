import { RangeView } from "../components/RangeView";

export const dynamic = "force-dynamic";

const title = "Bay Area Tech & Startup Events Tomorrow — Ranked";
const description =
  "Tomorrow's AI, startup and investor events across San Francisco and the Bay Area, scored 0–10 so you can plan the evening in seconds.";

export const metadata = {
  title,
  description,
  alternates: { canonical: "/tomorrow" },
  openGraph: { title, description, url: "/tomorrow", type: "website" },
};

export default function Page() {
  return (
    <RangeView range="tomorrow" path="/tomorrow" seoTitle={title} seoDescription={description} />
  );
}
