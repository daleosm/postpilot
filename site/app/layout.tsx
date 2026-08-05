import type { Metadata } from "next";
import type { ReactNode } from "react";

import { hasConfiguredMarketingSiteUrl, marketingSiteUrl } from "../lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(marketingSiteUrl),
  title: {
    default: "Cutluma | TV post-production operations",
    template: "%s | Cutluma",
  },
  description: "Workflow software for episodic television post-production facilities, available as Cutluma Cloud or self-hosted with an enterprise support path.",
  applicationName: "Cutluma",
  category: "Business software",
  keywords: ["TV post-production", "episodic television", "post house", "workflow", "managed cloud", "self-hosted"],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "/",
    siteName: "Cutluma",
    title: "Cutluma | TV post-production operations",
    description: "Workflow software for episodic TV post-production facilities: episodes, approvals, bookings, QC, delivery, and commercial operations.",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "Cutluma — workflow software for episodic TV post-production",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cutluma | TV post-production operations",
    description: "Workflow software for episodic TV post-production facilities.",
    images: ["/og.png"],
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
