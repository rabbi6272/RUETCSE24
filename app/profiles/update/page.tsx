import type { Metadata } from "next";

import { ProfileForm } from "../../components/profiles/ProfileForm";

export const metadata: Metadata = {
  title: "Edit profile",
  robots: { index: false, follow: false },
};

export default function UpdateProfilePage() {
  return <ProfileForm mode="update" />;
}
