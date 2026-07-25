import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    // Development only. Production ALB routing sends /v1 straight to the
    // FastAPI service, keeping the Next deployment a frontend container.
    const apiOrigin = process.env.POSTPILOT_API_ORIGIN;
    if (!apiOrigin) return [];
    return [{ source: "/v1/:path*", destination: `${apiOrigin.replace(/\/$/, "")}/v1/:path*` }];
  },
};

export default nextConfig;
