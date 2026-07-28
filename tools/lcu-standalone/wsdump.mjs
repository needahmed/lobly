import { execFileSync } from "node:child_process";
import { WebSocket } from "ws";

const out = execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine",
  ],
  { encoding: "utf8", windowsHide: true }
);
const port = out.match(/--app-port=([0-9]+)/)[1];
const token = Buffer.from(
  "riot:" + out.match(/--remoting-auth-token=([\w-]+)/)[1]
).toString("base64");

const ws = new WebSocket(`wss://127.0.0.1:${port}/`, {
  headers: { Authorization: `Basic ${token}` },
  rejectUnauthorized: false,
});

ws.on("open", () => {
  console.log("connected; subscribing exactly like the app does");
  ws.send(JSON.stringify([5, "OnJsonApiEvent_lol-lobby_v2_lobby"]));
});

ws.on("message", (raw) => {
  let f;
  try {
    f = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!Array.isArray(f) || f[0] !== 8) return;
  const [, name, evt] = f;
  const d = evt?.data;
  console.log(
    `event=${name}\n  uri=${evt?.uri}\n  type=${evt?.eventType}\n  dataKind=${
      d === null ? "null" : Array.isArray(d) ? `array(${d.length})` : typeof d
    }  queueId=${d?.gameConfig?.queueId ?? d?.queueId ?? "-"}\n`
  );
});

const seconds = Number(process.argv[2] ?? 25);
setTimeout(() => process.exit(0), seconds * 1000);
console.log(`Watching ${seconds}s — create/leave a lobby now.`);
