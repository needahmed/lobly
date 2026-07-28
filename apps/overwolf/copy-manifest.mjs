import { copyFileSync, cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const iconsSrc = join(root, "public", "icons");
const iconsDest = join(dist, "icons");

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
copyFileSync(join(root, "manifest.json"), join(dist, "manifest.json"));
if (existsSync(iconsSrc)) {
  mkdirSync(iconsDest, { recursive: true });
  cpSync(iconsSrc, iconsDest, { recursive: true });
}
console.log("[copy-manifest] manifest.json + icons → dist/");
