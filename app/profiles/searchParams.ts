import type { SectionFilter } from "../../types/Student";
import type { SeriesConfig } from "../../types/series";

/**
 * Coerces an untrusted `?sec=` value into a valid filter for the active
 * series. Anything unexpected — including a section that exists in another
 * series but not this one — falls back to "All" rather than reaching the
 * render as an impossible value.
 */
export function parseSection(
  value: string | null | undefined,
  entry: SeriesConfig,
): SectionFilter {
  if (value === "All") return "All";
  return entry.sections.find((section) => section === value) ?? "All";
}
