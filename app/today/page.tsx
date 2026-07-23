import { RangeView } from "../components/RangeView";

export const revalidate = 900;

export const metadata = {
  title: "Today",
  description: "Today's best Bay Area founder & investor events, ranked out of 10.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; tier?: string; all?: string }>;
}) {
  const sp = await searchParams;
  return <RangeView range="today" searchParams={sp} />;
}
