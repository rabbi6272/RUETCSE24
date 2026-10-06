import type { Metadata } from "next";

import { ProfileForm } from "../../components/profiles/ProfileForm";

export const metadata: Metadata = {
  title: "Create profile",
  robots: { index: false, follow: false },
};

export default function CreateProfilePage() {
  return <ProfileForm mode="create" />;
}
