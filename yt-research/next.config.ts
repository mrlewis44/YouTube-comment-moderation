import path from "node:path";
import type { NextConfig } from "next";

// This app lives inside the Comment Copilot repo but is its own project.
// Pin the root here so Next does not pick up the parent repo's lockfile.
const root = path.join(__dirname);

const nextConfig: NextConfig = {
  // This app is only an MCP endpoint; no pages, no images.
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
