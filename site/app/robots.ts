import type { MetadataRoute } from "next";

import { hasConfiguredMarketingSiteUrl, marketingSiteUrl } from "../lib/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  if (!hasConfiguredMarketingSiteUrl) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${marketingSiteUrl}/sitemap.xml`,
    host: marketingSiteUrl,
  };
}
