import type { MetadataRoute } from "next";

import { hasConfiguredMarketingSiteUrl, marketingSiteUrl } from "../lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!hasConfiguredMarketingSiteUrl) return [];

  return [
    {
      url: marketingSiteUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
