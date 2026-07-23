import { RangeView } from "./components/RangeView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "This Week",
  description:
    "This week's best Bay Area events for founders and investors — curated, scored, and ranked by signal.",
};

export default function Page() {
  return <RangeView range="this-week" />;
}
