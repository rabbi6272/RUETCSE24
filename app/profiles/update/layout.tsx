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
 * Server-side half of the bootstrap-password gate.
 *
 * The client half lives in `SignInPanel`, which redirects the moment a sign-in
 * succeeds. That is a convenience, not a control: a student who signed in
 * earlier, closed the tab, and comes back days later still holds a valid cookie
 * and never runs that code again. This check is what actually stops them
 * reaching an owner surface on a password that was public.
 *
 * It only covers the mutating surfaces. The directory and profile pages stay
 * public, because a pending rotation should not stop someone browsing.
 */
export default async function UpdateProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (session?.mustRotate) {
    redirect("/profiles/set-password");
  }

  return children;
}
