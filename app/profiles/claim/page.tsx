import type { Metadata } from "next";

import { ClaimFlow } from "../../components/profiles/ClaimFlow";

export const metadata: Metadata = {
  title: "Claim your profile",
  description:
    "Claim your existing RUET CSE 24 profile and carry your photo and bio over to the new directory.",
  alternates: { canonical: "/profiles/claim" },
};

interface ClaimPageProps {
  // The emailed sign-in link lands here with `oobCode` appended by Firebase.
  // `from=google`: the Google callback sent an old-directory address here.
  searchParams: Promise<{ oobCode?: string | string[]; from?: string | string[] }>;
}

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  const params = await searchParams;
  const raw = typeof params.oobCode === "string" ? params.oobCode : null;
  const oobCode = raw && raw.length <= 512 ? raw : null;

  return <ClaimFlow oobCode={oobCode} fromGoogle={params.from === "google"} />;
}
