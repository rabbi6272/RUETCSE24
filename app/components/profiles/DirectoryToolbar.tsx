"use client";

import { Search, X } from "../ui/Icon";
import { cn } from "../ui/cn";

import { SECTION_LABELS } from "../../../types/Student";

import type { SectionFilter } from "../../../types/Student";

export interface DirectoryToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  section: SectionFilter;
  onSectionChange: (value: SectionFilter) => void;
  /** The active series' sections, e.g. `["a","b","c"]`. */
  sections: readonly SectionFilter[];
  /** Total before filtering, and the count after. */
  total: number;
  shown: number;
}

/**
 * The section filter is a real radio group rather than a row of toggle buttons:
 * it is a single-choice set, so arrow-key navigation and a single tab stop are
 * what a keyboard user expects, and the fieldset/legend names the group for
 * screen readers.
 */
export function DirectoryToolbar({
  query,
  onQueryChange,
  section,
  onSectionChange,
  sections,
  total,
  shown,
}: DirectoryToolbarProps) {
  const hasQuery = query.trim().length > 0;
  const filtered = shown !== total;

  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <label htmlFor="directory-search" className="sr-only-focusable">
            Search profiles by name, nickname, email, or roll
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-fg-subtle" />
          <input
            id="directory-search"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search name, nickname, email, or roll"
            autoComplete="off"
            className={cn(
              "h-11 w-full rounded-control border border-border-strong bg-surface",
              "pl-11 pr-11 text-[0.9375rem] text-fg placeholder:text-fg-subtle",
              "transition-[border-color,box-shadow] duration-150",
              "focus:border-ink-700 focus:outline-none focus:ring-[3px] focus:ring-ink-900/15",
              // The native clear affordance duplicates our own button.
              "[&::-webkit-search-cancel-button]:appearance-none",
            )}
          />
          {hasQuery ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-ink-100 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <fieldset className="lg:shrink-0">
          <legend className="sr-only-focusable">Filter by section</legend>
          <div className="flex flex-wrap gap-1.5">
            {(["All", ...sections] as SectionFilter[]).map((value) => {
              const active = value === section;

              return (
                <label
                  key={value}
                  className={cn(
                    "inline-flex h-9 cursor-pointer select-none items-center rounded-control",
                    "border px-3.5 text-sm font-semibold transition-colors duration-150",
                    "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink-900",
                    active
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-border-strong bg-surface text-ink-700 hover:bg-ink-50",
                  )}
                >
                  <input
                    type="radio"
                    name="directory-section"
                    value={value}
                    checked={active}
                    onChange={() => onSectionChange(value)}
                    className="sr-only-focusable"
                  />
                  {SECTION_LABELS[value]}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      {/*
        `aria-live` on the count, so a screen reader hears the result set shrink
        or grow as filters change rather than only on request.
      */}
      <p
        role="status"
        aria-live="polite"
        className="mt-3 text-xs font-medium text-fg-muted"
      >
        {filtered
          ? `Showing ${shown} of ${total} profiles`
          : `${total} ${total === 1 ? "profile" : "profiles"}`}
      </p>
    </div>
  );
}
