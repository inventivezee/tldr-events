import { WeekPage } from "../components/WeekPage";

export const revalidate = 900;

export const metadata = {
  title: "Next Week",
  description:
    "Next week's best Bay Area events for founders and investors — plan ahead.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; tier?: string }>;
}) {
  const sp = await searchParams;
  return <WeekPage which="next" searchParams={sp} />;
}
