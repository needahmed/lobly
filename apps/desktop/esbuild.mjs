import * as esbuild from "esbuild";

/**
 * Build-time defaults for packaged apps. Runtime `process.env.LOBLY_*` still
 * wins when set on the machine that launches the exe.
 *
 * Example:
 *   LOBLY_BACKEND_URL=https://api.example.com npm run pack
 */
const packagedDefaults = {
  "process.env.LOBLY_PACKAGED_BACKEND_URL": JSON.stringify(
    process.env.LOBLY_BACKEND_URL ?? "http://localhost:8790"
  ),
  "process.env.LOBLY_PACKAGED_DEV_EMAIL": JSON.stringify(
    process.env.LOBLY_DEV_EMAIL ?? "dev@lobly.local"
  ),
  "process.env.LOBLY_PACKAGED_DEV_PASSWORD": JSON.stringify(
    process.env.LOBLY_DEV_PASSWORD ?? "lobly-dev-password"
  ),
};

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  outdir: "dist-electron",
  logLevel: "info",
  define: packagedDefaults,
};

await esbuild.build({ ...shared, entryPoints: ["electron/main.ts"] });
await esbuild.build({ ...shared, entryPoints: ["electron/preload.ts"] });
