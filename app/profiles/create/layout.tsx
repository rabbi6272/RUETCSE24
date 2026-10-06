import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth/session";
import { createMetadata } from "../../seo";

export const metadata: Metadata = createMetadata({
  title: "Create Profile",
  description: "Create a new RUET CSE student profile.",
  path: "/profiles/create",
  noIndex: true,
});

/** Same gate as `update/`: no owner surface is reachable before rotation. */
export default async function CreateProfileLayout({
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
