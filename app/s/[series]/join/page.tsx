import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JoinFlow } from "../../../components/profiles/JoinFlow";
import { buttonClasses } from "../../../components/ui/Button";
import { getSeries } from "../../../../types/series";

interface JoinPageProps {
  params: Promise<{ series: string }>;
}

export async function generateMetadata({
  params,
}: JoinPageProps): Promise<Metadata> {
  const { series } = await params;
  const entry = getSeries(series);
  if (!entry) return { title: "Join" };

  return {
    title: `Join the CSE ${entry.id} directory`,
    alternates: { canonical: `/s/${entry.id}/join` },
    robots: { index: false, follow: false },
  };
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { series } = await params;
  const entry = getSeries(series);
  if (!entry) notFound();

  if (entry.status !== "open") {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
        <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-tight text-fg">
            {entry.label} is closed
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            This series is no longer accepting new accounts. You can still
            browse the directory.
          </p>
          <Link
            href={`/s/${entry.id}`}
            className={`${buttonClasses("secondary", "sm")} mt-5 inline-flex`}
          >
            Back to the directory
          </Link>
        </div>
      </div>
    );
  }

  return (
    <JoinFlow seriesId={entry.id} />
  );
}
