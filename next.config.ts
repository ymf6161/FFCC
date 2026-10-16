import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  // CSV files are sent to server actions as text; the actions themselves cap them at 5 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
