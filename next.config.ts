import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["metaapi.cloud-sdk", "metaapi.cloud-metastats-sdk"],
};

export default nextConfig;
