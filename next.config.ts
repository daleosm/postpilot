import type { NextConfig } from "next";

import { securityResponseHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // These apply to every path, including static chunks that do not pass
  // through `src/proxy.ts`. The proxy adds the per-request nonce CSP for
  // navigations and redirects.
  async headers() {
    return [{ source: "/:path*", headers: [...securityResponseHeaders] }];
  },
  async rewrites() {
    // Development only. Production ALB routing sends /v1 straight to the
    // FastAPI service, keeping the Next deployment a frontend container.
    const apiOrigin = process.env.POSTPILOT_API_ORIGIN;
    if (!apiOrigin) return [];
    return [{ source: "/v1/:path*", destination: `${apiOrigin.replace(/\/$/, "")}/v1/:path*` }];
  },
  poweredByHeader: false,
};

export default nextConfig;
