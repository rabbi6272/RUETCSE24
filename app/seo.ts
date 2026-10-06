import type { Metadata } from "next";

import type { SeriesConfig } from "../types/series";

const fallbackSiteUrl = "https://ruetcsearchive.app";

/**
 * Site-wide identity: the *department*, not one cohort. Series-specific copy
 * (titles, descriptions, canonical paths) is layered on by `seriesMetadata`.
 */
export const siteConfig = {
  name: "RUET CSE",
  shortName: "CSE",
  description:
    "Student profile directories and batch archives for the Computer Science and Engineering department of Rajshahi University of Engineering and Technology.",
  tagline:
    "Student profile directories for Rajshahi University of Engineering and Technology CSE.",
  url: process.env.NEXT_PUBLIC_SITE_URL || fallbackSiteUrl,
  ogImage: "/icon.png",
  logo: "/RuetLogo.png",
  contactPage: "https://ruetcsearchive.app/contact&help/developers",
  facebookPage:
    "https://m.facebook.com/profile.php?id=61574730479807&name=xhp_nt__fb__action__open_user",
  email: "ruetcse24@gmail.com",
  keywords: [
    "RUET CSE",
    "RUET Computer Science and Engineering",
    "Rajshahi University of Engineering and Technology",
    "RUET students",
    "RUET CSE directory",
    "RUET student directory",
    "RUET student profiles",
    "RUET profile",
    "RUET batch",
    "Rajshahi University CSE",
  ],
};

export const siteUrl = new URL(siteConfig.url);

export function absoluteUrl(path = "/") {
  return new URL(path, siteUrl).toString();
}

export function createMetadata({
  title,
  description = siteConfig.description,
  path = "/",
  image = siteConfig.ogImage,
  noIndex = false,
}: {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
} = {}): Metadata {
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);
  const pageTitle = title || `${siteConfig.name} | Student Profile Directory`;

  return {
    title,
    description,
    keywords: siteConfig.keywords,
    alternates: {
      canonical,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      type: "website",
      url: canonical,
      title: pageTitle,
      description,
      siteName: siteConfig.name,
      locale: "en_US",
      images: [
        {
          url: imageUrl,
          width: 1729,
          height: 972,
          alt: `${siteConfig.name} preview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: [imageUrl],
    },
  };
}

/** Per-series metadata: canonical `/s/{id}` + series-scoped copy. */
export function seriesMetadata(entry: SeriesConfig): Metadata {
  return createMetadata({
    title: `RUET CSE ${entry.id} Student Directory`,
    description: `Browse student profiles from the RUET Computer Science and Engineering ${entry.admissionYear} series — search by name, roll, or section, and create your own entry.`,
    path: `/s/${entry.id}`,
  });
}
