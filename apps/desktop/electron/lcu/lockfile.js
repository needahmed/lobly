import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
function candidatePaths() {
    return [
        process.env.LOL_LOCKFILE_PATH,
        "C:\\Riot Games\\League of Legends\\lockfile",
        path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Riot Games", "League of Legends", "lockfile"),
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Riot Games", "League of Legends", "lockfile"),
    ].filter((p) => Boolean(p));
}
function fromLockfile() {
    for (const p of candidatePaths()) {
        try {
            if (!fs.existsSync(p))
                continue;
            const raw = fs.readFileSync(p, "utf8").trim();
            const parts = raw.split(":");
            if (parts.length < 5)
                continue;
            const port = parts[2];
            const password = parts[3];
            const token = Buffer.from(`riot:${password}`).toString("base64");
            return { port, token, source: `lockfile (${p})` };
        }
        catch {
            // try next candidate
        }
    }
    return null;
}
function fromProcessArgs() {
    try {
        const out = execFileSync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine",
        ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
        const portMatch = out.match(/--app-port=([0-9]+)/);
        const tokenMatch = out.match(/--remoting-auth-token=([\w-]+)/);
        if (portMatch && tokenMatch) {
            const token = Buffer.from(`riot:${tokenMatch[1]}`).toString("base64");
            return { port: portMatch[1], token, source: "LeagueClientUx.exe process args" };
        }
    }
    catch {
        // League not running, or PowerShell/CIM unavailable
    }
    return null;
}
/** Best-effort, non-throwing discovery — used by the poll loop in main.ts. */
export function tryDiscoverCredentials() {
    return fromLockfile() ?? fromProcessArgs();
}
