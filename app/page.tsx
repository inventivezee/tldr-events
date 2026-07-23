import { WeekPage } from "./components/WeekPage";

// ISR: rebuild at most every 15 min (SEO-indexed, fresh) (PRD §13).
export const revalidate = 900;

export const metadata = {
  title: "This Week",
  description:
    "This week's best Bay Area events for founders and investors — curated, scored, and summarized.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; tier?: string }>;
}) {
  const sp = await searchParams;
  return <WeekPage which="this" searchParams={sp} />;
}
