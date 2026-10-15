import { access, cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const standalone = path.join(".next", "standalone");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findServerDir(dir, depth = 0) {
  if (depth > 8) return null;
  if (await exists(path.join(dir, "server.js"))) return dir;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".next") continue;
    const found = await findServerDir(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

if (!(await exists(standalone))) process.exit(0);

let serverDir = path.join(standalone);
if (!(await exists(path.join(serverDir, "server.js")))) {
  serverDir = await findServerDir(standalone);
}

if (!serverDir) {
  console.error(
    "Missing .next/standalone/server.js. Hostinger starts that file; a nested monorepo path leaves the Node process down and the site returns 503.",
  );
  process.exit(1);
}

if (path.resolve(serverDir) !== path.resolve(standalone)) {
  if (await exists(path.join(serverDir, "node_modules"))) {
    await cp(path.join(serverDir, "node_modules"), path.join(standalone, "node_modules"), {
      recursive: true,
    });
  }
  if (await exists(path.join(serverDir, ".next"))) {
    await cp(path.join(serverDir, ".next"), path.join(standalone, ".next"), { recursive: true });
  }
  await cp(path.join(serverDir, "server.js"), path.join(standalone, "server.js"));
  if (await exists(path.join(serverDir, "package.json"))) {
    await cp(path.join(serverDir, "package.json"), path.join(standalone, "package.json"));
  }
}

const serverJs = path.join(standalone, "server.js");
const source = await readFile(serverJs, "utf8");
const patched = source.replace(
  "const hostname = process.env.HOSTNAME || '0.0.0.0'",
  "const hostname = '0.0.0.0'",
);
if (patched !== source) await writeFile(serverJs, patched);

await cp(path.join(".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});

if (await exists("public")) {
  await cp("public", path.join(standalone, "public"), { recursive: true });
}
