import { notFound } from "next/navigation";

import HomePageClient from "../../HomePageClient";
import { ProfileDirectory } from "../../components/profiles/ProfileDirectory";
import { parseSection } from "../../profiles/searchParams";
import { getSeries } from "../../../types/series";

interface SeriesPageProps {
  params: Promise<{ series: string }>;
  searchParams: Promise<{ q?: string | string[]; sec?: string | string[] }>;
}

export default async function SeriesPage({
  params,
  searchParams,
}: SeriesPageProps) {
  const { series } = await params;
  const entry = getSeries(series);
  if (!entry) notFound();

  const sp = await searchParams;
  const query = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  const rawSection = typeof sp.sec === "string" ? sp.sec : null;

  return (
    <>
      {/* The original CSE-24 batch archive lives above the directory; the
          floating hero button scrolls down to `#directory`. */}
      {entry.hasArchiveHome ? <HomePageClient /> : null}

      <div id="directory" className="scroll-mt-16">
        <ProfileDirectory
          seriesId={entry.id}
          initialQuery={query}
          initialSection={parseSection(rawSection, entry)}
        />
      </div>
    </>
  );
}
