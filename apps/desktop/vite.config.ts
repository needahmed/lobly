import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@lobly/shared-types": resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      "@lobly/client-core": resolve(__dirname, "../../packages/client-core/src/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
