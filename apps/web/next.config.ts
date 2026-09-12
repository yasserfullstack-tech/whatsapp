import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@wa/auth", "@wa/credentials", "@wa/db", "@wa/meta"],
};

export default nextConfig;
