import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { RangeView } from "../../components/RangeView";
import { CALENDAR_DAYS } from "@/web/data";

export const dynamic = "force-dynamic";

const TZ = "America/Los_Angeles";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day, or null if it isn't a real date inside the browsable range. */
function parseDay(date: string): DateTime | null {
  if (!ISO_DATE.test(date)) return null;
  const d = DateTime.fromISO(date, { zone: TZ }).startOf("day");
  if (!d.isValid) return null;
  const today = DateTime.now().setZone(TZ).startOf("day");
  const delta = Math.round(d.diff(today, "days").days);
  // Bound it: the pipeline only scores a forward window, and unbounded dates
  // would let a crawler spider infinite pages.
  if (delta < -1 || delta > CALENDAR_DAYS) return null;
  return d;
}

/** A date-specific title is what wins "events in SF on <date>" style searches,
 *  and gives an answer engine an unambiguous page to cite for that day. */
function seoFor(d: DateTime) {
  const long = d.toFormat("cccc, LLLL d, yyyy");
  return {
    title: `Bay Area Tech & Startup Events on ${d.toFormat("EEEE, MMMM d")} — Ranked`,
    description: `Every AI, startup and investor event in the San Francisco Bay Area on ${long}, scored 0-10 and ranked by signal.`,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const d = parseDay(date);
  if (!d) return { title: "Not found" };
  const { title, description } = seoFor(d);
  return {
    title,
    description,
    alternates: { canonical: `/day/${date}` },
    openGraph: { title, description, url: `/day/${date}`, type: "website" },
  };
}

export default async function Page({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const d = parseDay(date);
  if (!d) notFound();
  const { title, description } = seoFor(d);
  return (
    <RangeView
      range={{ day: date }}
      dayLabel={d.toFormat("cccc, LLLL d")}
      path={`/day/${date}`}
      seoTitle={title}
      seoDescription={description}
    />
  );
}
