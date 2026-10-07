"use client";

import Link from "next/link";

import { useUnclaimedCount } from "../../../lib/db/students/students.hooks";

import { buttonClasses } from "../ui/Button";
import { Alert } from "../ui/Icon";

import type { SeriesConfig } from "../../../types/series";

/**
 * Drives the legacy-migration call to action. The count comes from a server
 * action rather than a public query, so it stays accurate without exposing the
 * legacy collection to clients.
 *
 * Legacy claims exist only for series 24 — the callout (and its server action
 * fetch) renders only where `entry.hasLegacyClaims` is true.
 */
export function DirectoryHeader({ entry }: { entry: SeriesConfig }) {
  const { data: unclaimed, isError } = useUnclaimedCount(entry.hasLegacyClaims);
  const showClaimCallout = entry.hasLegacyClaims && !isError && !!unclaimed && unclaimed > 0;

  return (
    <header className="mb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
            RUET CSE {entry.id}
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            Student directory
          </h1>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-fg-muted">
            Find classmates by name, roll, or nickname.
            {entry.hasLegacyClaims
              ? " Claim your pre-existing entry to keep it and make it editable."
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {entry.status === "open" ? (
            <Link href={`/s/${entry.id}/join`} className={buttonClasses("primary", "sm")}>
              Create account
            </Link>
          ) : null}
          <Link
            href="/profiles/update"
            className={buttonClasses(entry.status === "open" ? "secondary" : "primary", "sm")}
          >
            Sign in
          </Link>
        </div>
      </div>

      {showClaimCallout ? (
        <div className="mt-5 flex flex-col gap-3 rounded-card border border-border-strong bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-ink-800">
            <Alert className="mt-0.5 size-4 shrink-0 text-ink-600" />
            <span>
              <strong className="font-bold">{unclaimed} profiles</strong> are
              waiting to be claimed. If you joined before this site moved to
              Firebase, reclaim yours to keep your photo and bio.
            </span>
          </p>
          <Link
            href="/profiles/claim"
            className={buttonClasses("secondary", "sm", "shrink-0")}
          >
            Claim your profile
          </Link>
        </div>
      ) : null}
    </header>
  );
}
