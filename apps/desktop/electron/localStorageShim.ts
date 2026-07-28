import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * client-core's auth persistence (packages/client-core/src/api/client.ts)
 * calls the browser `localStorage` global directly — correct for Overwolf,
 * where that code runs inside a real Chromium window, but Electron's main
 * process is plain Node with no such global. Install a tiny file-backed
 * stand-in before any client-core code runs, so that module needs zero
 * changes to work in both hosts.
 */
class FileLocalStorage {
  private readonly file = path.join(app.getPath("userData"), "localStorage.json");
  private data: Record<string, string> = {};

  constructor() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  private persist() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch {
      /* best-effort */
    }
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
  }

  setItem(key: string, value: string) {
    this.data[key] = value;
    this.persist();
  }

  removeItem(key: string) {
    delete this.data[key];
    this.persist();
  }

  clear() {
    this.data = {};
    this.persist();
  }
}

export function installLocalStorageShim() {
  (globalThis as any).localStorage = new FileLocalStorage();
}
