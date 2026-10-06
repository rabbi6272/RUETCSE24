import type { Metadata, Viewport } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import { lato } from "./ui/fonts";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "./providers";
import { createMetadata, siteConfig, siteUrl } from "./seo";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  ...createMetadata({
    description: siteConfig.description,
  }),
  title: {
    default: `${siteConfig.name} | Student Profile Directory`,
    template: `%s | ${siteConfig.name}`,
  },
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.name }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: "education",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  referrer: "origin-when-cross-origin",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    alternateName: siteConfig.shortName,
    url: siteConfig.url,
    description: siteConfig.description,
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      logo: new URL(siteConfig.logo, siteUrl).toString(),
    },
    about: {
      "@type": "CollegeOrUniversity",
      name: "Rajshahi University of Engineering and Technology",
      alternateName: "RUET",
    },
  };

  const organizationData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    alternateName: "RUET CSE Department",
    url: siteConfig.url,
    logo: new URL(siteConfig.logo, siteUrl).toString(),
    email: siteConfig.email,
    sameAs: [siteConfig.facebookPage, siteConfig.contactPage],
    keywords: siteConfig.keywords.join(", "),
  };

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
        />
      </head>
      <body className={`${lato.className}`}>
        <Providers>
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "#171717",
                color: "#ffffff",
                borderRadius: "10px",
                fontSize: "0.875rem",
                fontWeight: 600,
                boxShadow: "0 4px 12px rgb(0 0 0 / 0.08), 0 2px 4px rgb(0 0 0 / 0.04)",
              },
              success: { iconTheme: { primary: "#ffffff", secondary: "#171717" } },
              error: { iconTheme: { primary: "#171717", secondary: "#ffffff" } },
            }}
          />
          <Analytics />
          {children}
        </Providers>
      </body>
    </html>
  );
}
