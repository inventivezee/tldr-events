import { RangeView } from "../components/RangeView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Next Week",
  description: "Next week's best Bay Area founder & investor events, ranked by signal.",
};

export default function Page() {
  return <RangeView range="next-week" />;
}
