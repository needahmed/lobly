import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "public/icons/*.png", dest: "icons" },
        { src: "public/icons/*.ico", dest: "icons" },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@lobly/shared-types": resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      "@lobly/client-core": resolve(__dirname, "../../packages/client-core/src/index.ts"),
      "@lobly/lcu-endpoints": resolve(__dirname, "../../packages/lcu-endpoints/endpoints.json"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/windows/background/background.html"),
        desktop: resolve(__dirname, "src/windows/desktop/desktop.html"),
        notifications: resolve(__dirname, "src/windows/notifications/notifications.html"),
      },
    },
  },
});
