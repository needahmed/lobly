import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Next 14 traces from the repo lockfile, so a standalone build would emit
  // `.next/standalone/apps/web/server.js`. Hostinger starts
  // `.next/standalone/server.js` and returns 503 when that file is absent.
  experimental: {
    outputFileTracingRoot: appDir,
  },
  images: { unoptimized: true },
};

export default nextConfig;
