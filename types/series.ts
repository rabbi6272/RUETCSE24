import type { Section } from "./Student";

/**
 * The registry of CSE series the directory knows about.
 *
 * This is the single source of truth for roll formats, sections, labels, and
 * availability. Adding a historical series is a data change: append an entry,
 * nothing else. Zod schemas, the UI, the landing picker, and SEO metadata all
 * read from here; Firestore rules keep only a loose structural guard (they
 * cannot import this module).
 *
 * Roll format: 7 digits — `YY` (admission year suffix) + `03` (CSE dept) +
 * 3-digit serial. The series id is the two-digit roll prefix (`"24"`), which
 * also makes `roll.startsWith(id)` a trivial consistency check.
 */

export interface SeriesConfig {
  /** Two-digit roll prefix, e.g. `"24"`. Used in URLs (`/s/24`). */
  id: string;
  admissionYear: number;
  /** Human label, e.g. `"2024 series"` — used in UI copy and page titles. */
  label: string;
  rollPattern: RegExp;
  sections: readonly Section[];
  /** Derives the section from a roll, or `null` when out of range. */
  sectionFromRoll: (roll: string) => Section | null;
  /** `archived` disables join/signup for the series. */
  status: "open" | "archived";
  /** Only series 24 has pre-migration legacy profiles and the claim flow. */
  hasLegacyClaims: boolean;
  /** Only series 24 keeps the original batch-archive home hero. */
  hasArchiveHome: boolean;
}

/** 60 students per section for the modern roll shape. */
function sectionFromSerial(serial: number): Section | null {
  if (!Number.isInteger(serial) || serial < 1) return null;
  if (serial <= 60) return "a";
  if (serial <= 120) return "b";
  if (serial <= 180) return "c";
  return null;
}

/** `sectionFromRoll` for rolls shaped `<prefix><3-digit serial>`. */
function sectionsFor(prefix: string): (roll: string) => Section | null {
  return (roll) => {
    const trimmed = roll.trim();
    if (!trimmed.startsWith(prefix)) return null;
    return sectionFromSerial(Number(trimmed.slice(prefix.length)));
  };
}

// Series 24 keeps the original explicit ranges so behaviour is byte-identical
// to the pre-registry implementation.
const SECTION_ROLL_RANGES: Array<{ sec: Section; min: number; max: number }> = [
  { sec: "a", min: 2403001, max: 2403060 },
  { sec: "b", min: 2403061, max: 2403120 },
  { sec: "c", min: 2403121, max: 2403180 },
];

function sectionFromRoll24(roll: string): Section | null {
  const rollNumber = Number(roll.trim());
  if (!Number.isInteger(rollNumber)) return null;
  return SECTION_ROLL_RANGES.find(({ min, max }) => rollNumber >= min && rollNumber <= max)?.sec ?? null;
}

export const SERIES: readonly SeriesConfig[] = [
  // Confirmed by live data: 10 published profiles carry `2503xxx` rolls whose
  // stored sections match the 60-per-section derivation below.
  {
    id: "25",
    admissionYear: 2025,
    label: "2025 series",
    rollPattern: /^2503\d{3}$/,
    sections: ["a", "b", "c"],
    sectionFromRoll: sectionsFor("2503"),
    status: "open",
    hasLegacyClaims: false,
    hasArchiveHome: false,
  },
  {
    id: "24",
    admissionYear: 2024,
    label: "2024 series",
    rollPattern: /^2403\d{3}$/,
    sections: ["a", "b", "c"],
    sectionFromRoll: sectionFromRoll24,
    status: "open",
    hasLegacyClaims: true,
    hasArchiveHome: true,
  },
  // Historical entries below share the same roll shape (`YY` + `03` + serial).
  // VERIFY against real roll numbers before these series hold real data —
  // section derivation assumes 60-per-section up to 180.
  {
    id: "23",
    admissionYear: 2023,
    label: "2023 series",
    rollPattern: /^2303\d{3}$/,
    sections: ["a", "b", "c"],
    sectionFromRoll: sectionsFor("2303"),
    status: "open",
    hasLegacyClaims: false,
    hasArchiveHome: false,
  },
  {
    id: "22",
    admissionYear: 2022,
    label: "2022 series",
    rollPattern: /^2203\d{3}$/,
    sections: ["a", "b", "c"],
    sectionFromRoll: sectionsFor("2203"),
    status: "open",
    hasLegacyClaims: false,
    hasArchiveHome: false,
  },
  {
    id: "21",
    admissionYear: 2021,
    label: "2021 series",
    rollPattern: /^2103\d{3}$/,
    sections: ["a", "b", "c"],
    sectionFromRoll: sectionsFor("2103"),
    status: "open",
    hasLegacyClaims: false,
    hasArchiveHome: false,
  },
  {
    id: "20",
    admissionYear: 2020,
    label: "2020 series",
    rollPattern: /^2003\d{3}$/,
    sections: ["a", "b", "c"],
    sectionFromRoll: sectionsFor("2003"),
    status: "open",
    hasLegacyClaims: false,
    hasArchiveHome: false,
  },
];

export function getSeries(id: string): SeriesConfig | null {
  return SERIES.find((entry) => entry.id === id) ?? null;
}

export function seriesFromRoll(roll: string): SeriesConfig | null {
  const trimmed = roll.trim();
  if (!trimmed) return null;
  return SERIES.find((entry) => entry.rollPattern.test(trimmed)) ?? null;
}

/** The section a roll belongs to, across any registered series. */
export function getSectionFromRoll(roll: string): Section | null {
  return seriesFromRoll(roll)?.sectionFromRoll(roll) ?? null;
}

/** Union of every registered section, for generic UI fallbacks. */
export function allSections(): readonly Section[] {
  const union = new Set<Section>();
  for (const entry of SERIES) for (const sec of entry.sections) union.add(sec);
  return [...union].sort();
}

// Fail fast at module load: two entries matching the same roll would make
// `seriesFromRoll` ambiguous, and a pattern that rejects its own example roll
// would silently exclude a series from every derivation. Samples use each
// entry's own shape (`YY03001`, serial 001 → section `a`).
for (const entry of SERIES) {
  const sample = `${entry.id}03001`;

  if (!entry.rollPattern.test(sample)) {
    throw new Error(
      `Series registry: pattern ${entry.rollPattern} rejects its sample roll ${sample}`,
    );
  }

  const matches = SERIES.filter((candidate) => candidate.rollPattern.test(sample));
  if (matches.length !== 1) {
    throw new Error(
      `Series registry overlap: ${sample} matched ${matches.map((m) => m.id).join(", ")}`,
    );
  }

  if (seriesFromRoll(sample)?.id !== entry.id) {
    throw new Error(
      `Series registry: seriesFromRoll(${sample}) did not round-trip to "${entry.id}"`,
    );
  }

  if (entry.sectionFromRoll(sample) === null) {
    throw new Error(
      `Series registry: section derivation rejected sample roll ${sample}`,
    );
  }
}
