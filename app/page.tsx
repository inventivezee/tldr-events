import { RangeView } from "./components/RangeView";

// ISR: rebuild at most every 15 min (SEO-indexed, fresh) (PRD §13).
export const revalidate = 900;

export const metadata = {
  title: "This Week",
  description:
    "This week's best Bay Area events for founders and investors — curated, scored out of 10, and summarized.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; tier?: string; all?: string }>;
}) {
  const sp = await searchParams;
  return <RangeView range="this-week" searchParams={sp} />;
}
