import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
// npm workspaces hoist `next` and friends into the repo-root node_modules, so
// tracing must start at the monorepo root or the standalone bundle ships
// without them ("Cannot find module 'next'" at runtime on Hostinger).
// The server then lands at .next/standalone/apps/web/server.js;
// scripts/prepare-standalone.mjs lifts it to .next/standalone/server.js,
// which is the path Hostinger starts.
const repoRoot = path.join(appDir, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    outputFileTracingRoot: repoRoot,
  },
  images: { unoptimized: true },
};

export default nextConfig;
