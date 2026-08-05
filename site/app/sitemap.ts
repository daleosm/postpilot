import type { MetadataRoute } from "next";

import { hasConfiguredMarketingSiteUrl, marketingSiteUrl } from "../lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!hasConfiguredMarketingSiteUrl) return [];

  return ["", "/product", "/evaluate", "/deployment", "/contribute", "/faq"].map((path, index) => ({
    url: `${marketingSiteUrl}${path}`,
    changeFrequency: "weekly" as const,
    priority: index === 0 ? 1 : 0.8,
  }));
}
