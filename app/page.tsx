import type { Metadata } from "next";
import Link from "next/link";

import { countPublishedBySeries } from "../lib/db/students/students.admin.repo";
import { SERIES } from "../types/series";
import { absoluteUrl, createMetadata, siteConfig } from "./seo";

export const metadata: Metadata = createMetadata({
  title: "RUET CSE — Series Directories",
  description:
    "Pick a CSE series to browse its student directory — profiles, rolls, and sections for every batch of the Computer Science and Engineering department at RUET.",
  path: "/",
});

// Counts change as profiles publish; ISR keeps the picker fresh without
// re-running the Admin queries on every visit.
export const revalidate = 300;

/**
 * The site root is a picker: one card per registered series, each linking to
 * its own directory at `/s/[series]`. Counts are read live (Admin SDK, two
 * equality-only queries per series) so the cards never go stale.
 */
export default async function SeriesPickerPage() {
  const counts = await Promise.all(
    SERIES.map((entry) => countPublishedBySeries(entry.id).catch(() => 0)),
  );

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: siteConfig.name,
    url: absoluteUrl("/"),
    description: siteConfig.description,
    about: [
      {
        "@type": "CollegeOrUniversity",
        name: "Rajshahi University of Engineering and Technology",
        alternateName: "RUET",
      },
      {
        "@type": "EducationalOccupationalProgram",
        name: "Computer Science and Engineering",
      },
    ],
    isPartOf: {
      "@type": "WebSite",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    mainEntity: {
      "@type": "ItemList",
      name: "RUET CSE series directories",
      itemListElement: SERIES.map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: entry.label,
        url: absoluteUrl(`/s/${entry.id}`),
      })),
    },
    keywords: siteConfig.keywords.join(", "),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="max-w-prose">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
            Rajshahi University of Engineering and Technology
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            RUET CSE directories
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-fg-muted sm:text-base">
            Student profile directories for every Computer Science and
            Engineering series. Pick yours to browse by name, roll, or section.
          </p>
        </header>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERIES.map((entry, index) => (
            <li key={entry.id}>
              <Link
                href={`/s/${entry.id}`}
                className="group flex h-full flex-col rounded-panel border border-border bg-surface p-6 shadow-card transition-colors hover:border-ink-300 hover:bg-ink-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
                    {entry.label}
                  </p>
                  <span
                    className={
                      entry.status === "open"
                        ? "rounded-full border border-success/30 bg-success-soft px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-success"
                        : "rounded-full border border-border-strong bg-ink-100 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-ink-600"
                    }
                  >
                    {entry.status === "open" ? "Open" : "Archived"}
                  </span>
                </div>

                <h2 className="mt-3 text-2xl font-bold tracking-tight text-fg">
                  CSE-{entry.id}
                </h2>

                <p className="mt-auto pt-4 text-sm text-fg-muted">
                  {counts[index]} {counts[index] === 1 ? "profile" : "profiles"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
