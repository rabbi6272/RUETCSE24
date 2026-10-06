import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth/session";
import { SetPasswordForm } from "../../components/profiles/SetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * Sits outside `update/` and `create/` on purpose. Those two layouts hold the
 * gate, and the gate redirects here, so living underneath either one would make
 * this page redirect to itself.
 */
export default async function SetPasswordPage() {
  const session = await getSession();

  // Nothing to rotate without a session, or nothing to rotate once the claim is
  // gone. Both cases belong back on the normal profile page.
  if (!session?.mustRotate) {
    redirect("/profiles/update");
  }

  return (
    <SetPasswordForm email={session.email} needsSection={session.needsSection} />
  );
}
