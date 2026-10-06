export type ClassValue = string | number | null | undefined | false | ClassValue[];

/**
 * Minimal class name joiner. The project has no `clsx`/`cva` dependency and the
 * variant maps below are small enough not to need one.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value));
    }
  }

  return out.join(" ");
}
