import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  // The Playground reuses Studio's real components, straight from source.
  transpilePackages: ["@postseed/studio", "@postseed/core"],
  turbopack: { root: resolve(process.cwd(), "../..") },
};

export default config;
