"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { useProfiles } from "../../../lib/db/students/students.hooks";
import { getSeries } from "../../../types/series";

import { buttonClasses } from "../ui/Button";
import { EmptyState, ErrorState, ProfileGridSkeleton } from "../ui/StateBlock";
import { DirectoryHeader } from "./DirectoryHeader";
import { DirectoryToolbar } from "./DirectoryToolbar";
import { ProfileCard } from "./ProfileCard";

import type { Profile, SectionFilter } from "../../../types/Student";

/**
 * Filter state is mirrored into the query string so a filtered view can be
 * shared or reloaded. `history.replaceState` is used rather than a router
 * navigation: filters are not navigation, and routing would remount the list on
 * every keystroke and discard the scroll position.
 */
function syncUrl(nextQuery: string, nextSection: SectionFilter) {
  const params = new URLSearchParams();

  if (nextQuery.trim()) params.set("q", nextQuery.trim());
  if (nextSection !== "All") params.set("sec", nextSection);

  const search = params.toString();
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;

  window.history.replaceState(null, "", url);
}

export interface ProfileDirectoryProps {
  /**
   * Registered series id (`"24"`). Passed as a plain string because
   * `SeriesConfig` carries a RegExp and functions, which cannot cross the
   * server→client boundary — the entry is re-looked-up here instead.
   */
  seriesId: string;
  initialQuery?: string;
  initialSection?: SectionFilter;
}

export function ProfileDirectory({
  seriesId,
  initialQuery = "",
  initialSection = "All",
}: ProfileDirectoryProps) {
  const entry = getSeries(seriesId);

  const [query, setQuery] = useState(initialQuery);
  const [section, setSection] = useState<SectionFilter>(initialSection);

  const { data: profiles, isPending, isError, refetch, isFetching } =
    useProfiles(seriesId);

  // Debounce so typing does not rewrite history on every keystroke.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const timer = setTimeout(() => syncUrl(query, section), 250);
    return () => clearTimeout(timer);
  }, [query, section]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all: Profile[] = profiles ?? [];

    return all.filter((profile) => {
      const matchesSection = section === "All" || profile.sec === section;

      if (!matchesSection) return false;
      if (!needle) return true;

      // `email` is the only contact field searched: mobile numbers live in a
      // collection the client cannot read, by design.
      return (
        profile.fullName.toLowerCase().includes(needle) ||
        profile.nickname.toLowerCase().includes(needle) ||
        profile.email.toLowerCase().includes(needle) ||
        profile.bloodGroup.toLowerCase().includes(needle) ||
        profile.roll.toLowerCase().includes(needle)
      );
    });
  }, [profiles, query, section]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setSection("All");
  }, []);

  const hasFilters = query.trim().length > 0 || section !== "All";

  // The series page already 404s unknown ids; this only guards a stale link.
  if (!entry) return null;

  return (
    <div className="mx-auto w-full md:w-[90%] xl:w-[80%] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <DirectoryHeader entry={entry} />

      {profiles && (
        <DirectoryToolbar
          query={query}
          onQueryChange={setQuery}
          section={section}
          onSectionChange={setSection}
          sections={entry.sections}
          total={profiles.length}
          shown={filtered.length}
        />
      )}

      <div className="mt-6">
        {isPending ? <ProfileGridSkeleton /> : null}

        {isError ? (
          <ErrorState
            title="Could not load the directory"
            description="The profile list failed to load. This is usually temporary."
            onRetry={() => void refetch()}
          />
        ) : null}

        {profiles && filtered.length === 0 ? (
          hasFilters ? (
            <EmptyState
              title="No profiles match those filters"
              description="Try a different name, roll, or section."
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className={buttonClasses("secondary", "sm")}
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No profiles yet"
              description="Be the first to add a profile to the directory."
              action={
                entry.status === "open" ? (
                  <Link href={`/s/${entry.id}/join`} className={buttonClasses("primary", "sm")}>
                    Create account
                  </Link>
                ) : undefined
              }
            />
          )
        ) : null}

        {profiles && filtered.length > 0 ? (
          <>
            <ul
              className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
              aria-busy={isFetching || undefined}
            >
              {filtered.map((profile) => (
                <li key={profile.id}>
                  <ProfileCard profile={profile} />
                </li>
              ))}
            </ul>

            <p role="status" aria-live="polite" className="sr-only-focusable">
              {isFetching ? "Updating results" : `${filtered.length} profiles shown`}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
