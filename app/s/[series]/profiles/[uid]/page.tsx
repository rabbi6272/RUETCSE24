import type { Metadata } from "next";

import { ProfileDetail } from "../../../../components/profiles/ProfileDetail";

interface ProfilePageProps {
  params: Promise<{ series: string; uid: string }>;
}

export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: true },
};

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { uid } = await params;

  return <ProfileDetail id={uid} />;
}
