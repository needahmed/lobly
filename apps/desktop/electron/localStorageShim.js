import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
/**
 * client-core's auth persistence (packages/client-core/src/api/client.ts)
 * calls the browser `localStorage` global directly — correct for Overwolf,
 * where that code runs inside a real Chromium window, but Electron's main
 * process is plain Node with no such global. Install a tiny file-backed
 * stand-in before any client-core code runs, so that module needs zero
 * changes to work in both hosts.
 */
class FileLocalStorage {
    file = path.join(app.getPath("userData"), "localStorage.json");
    data = {};
    constructor() {
        try {
            this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        }
        catch {
            this.data = {};
        }
    }
    persist() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.data));
        }
        catch {
            /* best-effort */
        }
    }
    getItem(key) {
        if (!Object.prototype.hasOwnProperty.call(this.data, key))
            return null;
        return decodeStored(this.data[key]);
    }
    setItem(key, value) {
        this.data[key] = encodeStored(value);
        this.persist();
    }
    removeItem(key) {
        delete this.data[key];
        this.persist();
    }
    clear() {
        this.data = {};
        this.persist();
    }
}
export function installLocalStorageShim() {
    globalThis.localStorage = new FileLocalStorage();
}
function encryptionAvailable() {
    try {
        return safeStorage.isEncryptionAvailable();
    }
    catch {
        return false;
    }
}
function encodeStored(value) {
    if (!encryptionAvailable())
        return value;
    const enc = safeStorage.encryptString(value);
    return `enc:${enc.toString("base64")}`;
}
function decodeStored(raw) {
    if (!raw.startsWith("enc:"))
        return raw;
    if (!encryptionAvailable())
        return raw;
    try {
        return safeStorage.decryptString(Buffer.from(raw.slice(4), "base64"));
    }
    catch {
        return raw;
    }
}
