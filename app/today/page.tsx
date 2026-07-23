import { RangeView } from "../components/RangeView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Today",
  description: "Today's best Bay Area founder & investor events, ranked by signal.",
};

export default function Page() {
  return <RangeView range="today" />;
}
