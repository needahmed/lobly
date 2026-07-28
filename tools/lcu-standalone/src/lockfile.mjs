import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_PATHS = [
  process.env.LOL_LOCKFILE_PATH,
  "C:\\Riot Games\\League of Legends\\lockfile",
  path.join(
    process.env["ProgramFiles"] ?? "C:\\Program Files",
    "Riot Games",
    "League of Legends",
    "lockfile"
  ),
  path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Riot Games",
    "League of Legends",
    "lockfile"
  ),
].filter(Boolean);

function fromLockfile() {
  for (const p of DEFAULT_PATHS) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8").trim();
      // format: "LeagueClient:pid:port:password:https"
      const parts = raw.split(":");
      if (parts.length < 5) continue;
      const port = parts[2];
      const password = parts[3];
      const token = Buffer.from(`riot:${password}`).toString("base64");
      return { port, token, source: `lockfile (${p})` };
    } catch {
      // try next candidate
    }
  }
  return null;
}

function fromProcessArgs() {
  // Modern Windows fallback for the classic `wmic` trick — CIM cmdlets
  // survive on Windows 10/11 even where wmic.exe is deprecated/removed.
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 }
    );
    const portMatch = out.match(/--app-port=([0-9]+)/);
    const tokenMatch = out.match(/--remoting-auth-token=([\w-]+)/);
    if (portMatch && tokenMatch) {
      const token = Buffer.from(`riot:${tokenMatch[1]}`).toString("base64");
      return { port: portMatch[1], token, source: "LeagueClientUx.exe process args" };
    }
  } catch {
    // League not running, PowerShell unavailable, or CIM query failed
  }
  return null;
}

/**
 * Discover LCU port + Basic-auth token without Overwolf's GEP.
 * Mirrors the same two paths documented in 00_BUILD_OVERVIEW.md C1/C3:
 * lockfile first, running-process command line as fallback.
 */
export function discoverCredentials() {
  const creds = fromLockfile() ?? fromProcessArgs();
  if (!creds) {
    throw new Error(
      "Could not find League Client credentials. Is the League client " +
        "running and logged in? Set LOL_LOCKFILE_PATH to point at a " +
        "non-default lockfile location if needed."
    );
  }
  return creds;
}
