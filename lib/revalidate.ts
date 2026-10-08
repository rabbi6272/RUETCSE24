import "server-only";

import { revalidatePath } from "next/cache";

/**
 * Drops every cached page and the client router cache, so the next request
 * anywhere renders fresh data — the home page's per-series counts (ISR,
 * `revalidate = 300`) included. Called after anything that changes who exists
 * or what the directory shows: sign-up (password or Google), profile
 * create/update, claim, account deletion.
 *
 * The site is small, so blanket revalidation is cheaper to reason about than
 * per-route tags that can drift out of sync with the routes.
 */
export function revalidateAll(): void {
  // The home page (`app/page.tsx`) is ISR-cached for 5 minutes and shows
  // `countPublishedBySeries` per series — named explicitly so those counts
  // are re-read on the next visit after any profile change.
  revalidatePath("/");
  // Everything else under the root layout (series directories, profiles).
  revalidatePath("/", "layout");
}
