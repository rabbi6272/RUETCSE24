import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth/session";
import { createMetadata } from "../../seo";

export const metadata: Metadata = createMetadata({
  title: "Update Profile",
  description: "Update an existing RUET CSE student profile.",
  path: "/profiles/update",
  noIndex: true,
});

/**
 * Old-directory gate. Sign-in no longer opens a session for a seeded account
 * still on its public pincode, but a cookie minted before that change can live
 * for days; this sends it to Claim, the only way to reclaim such an account.
 *
 * It only covers the mutating surfaces. The directory and profile pages stay
 * public.
 */
export default async function UpdateProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (session?.mustRotate) {
    redirect("/profiles/claim");
  }

  return children;
}
