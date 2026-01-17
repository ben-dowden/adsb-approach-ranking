import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@adsb/shared"],
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
