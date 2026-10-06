import type { Metadata } from "next";

import { Navbar } from "../components/Navbar";
import { createMetadata } from "../seo";

export const metadata: Metadata = createMetadata({
  title: "RUET Student Profiles",
  description:
    "Browse the RUET CSE student profile directory by name, roll, section, and email address.",
  path: "/profiles",
});

export default function ProfilesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-64px)]">{children}</main>
    </>
  );
}
