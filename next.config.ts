import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    esmExternals: true,
  },
  // Pretty public path for the HITL webhooks (matches HITL_DESIGN.md / the
  // runbook): /haia/hitl/* → the actual API routes at /api/hitl/*.
  async rewrites() {
    return [
      { source: "/haia/hitl/:path*", destination: "/api/hitl/:path*" },
    ];
  },
};

export default nextConfig;
