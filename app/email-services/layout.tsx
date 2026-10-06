import type { Metadata } from "next";

import { createMetadata } from "../seo";

export const metadata: Metadata = createMetadata({
  title: "Email Services",
  description: "Internal email tools for RUET CSE.",
  path: "/email-services",
  noIndex: true,
});

export default function EmailServicesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
