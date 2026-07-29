import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep cubing.js unbundled on the server so its scramble worker entry
  // resolves correctly (bundling commonly causes hangs / timeouts).
  serverExternalPackages: ["cubing"],
};

export default nextConfig;
