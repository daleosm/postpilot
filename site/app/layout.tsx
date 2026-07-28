import type { Metadata } from "next";
import type { ReactNode } from "react";

import { hasConfiguredMarketingSiteUrl, marketingSiteUrl } from "../lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(marketingSiteUrl),
  title: {
    default: "Cutluma | Open-source TV post-production operations",
    template: "%s | Cutluma",
  },
  description: "Open-source, self-hosted workflow software for episodic television post-production facilities.",
  applicationName: "Cutluma",
  category: "Business software",
  keywords: ["TV post-production", "episodic television", "post house", "workflow", "self-hosted", "open source"],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "/",
    siteName: "Cutluma",
    title: "Cutluma | Open-source TV post-production operations",
    description: "Workflow software for episodic TV post-production facilities: episodes, approvals, bookings, QC, delivery, and commercial operations.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Cutluma — open-source workflow software for episodic TV post-production",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cutluma | Open-source TV post-production operations",
    description: "Workflow software for episodic TV post-production facilities.",
    images: ["/opengraph-image"],
  },
  robots: hasConfiguredMarketingSiteUrl
    ? { index: true, follow: true }
    : { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
