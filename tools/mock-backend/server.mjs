import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8790;
const endpointsPath = join(__dirname, "../../packages/lcu-endpoints/endpoints.json");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.post("/v1/auth/dev-login", (req, res) => {
  const email = req.body?.email ?? "dev@lobly.local";
  res.json({ accessToken: `dev-${email}` });
});

app.get("/config/lcu-endpoints", (_req, res) => {
  const json = readFileSync(endpointsPath, "utf8");
  res.type("json").send(json);
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

const syncNs = io.of("/sync");
/** @type {Map<string, { status: string, lastPayload: unknown }>} */
const listings = new Map();

syncNs.on("connection", (socket) => {
  const token = socket.handshake.auth?.token ?? "anon";
  console.log(`[sync] connect ${socket.id} token=${token}`);
  listings.set(socket.id, { status: "DRAFT", lastPayload: null });

  const events = [
    "listing.publish",
    "listing.pause",
    "listing.delist",
    "listing.ready",
    "listing.reopen",
    "listing.relist",
    "session.start",
    "session.end",
    "presence.heartbeat",
  ];

  for (const event of events) {
    socket.on(event, (payload, ack) => {
      console.log(`[sync] ${event}`, JSON.stringify(payload));
      const cur = listings.get(socket.id) ?? { status: "DRAFT", lastPayload: null };
      const serverStatus =
        payload?.status ??
        ({
          "listing.publish": "LISTED",
          "listing.pause": "PAUSED",
          "listing.delist": "DELISTED",
          "listing.ready": "READY",
          "listing.reopen": "LISTED",
          "listing.relist": "LISTED",
          "session.start": "IN_SESSION",
          "session.end": "POST_SESSION",
        }[event] ?? cur.status);
      listings.set(socket.id, { status: serverStatus, lastPayload: payload });
      if (typeof ack === "function") ack({ ok: true, serverStatus });
      else socket.emit("sync.ack", { event, ok: true, serverStatus });
    });
  }

  socket.on("disconnect", () => {
    console.log(`[sync] disconnect ${socket.id}`);
    listings.delete(socket.id);
  });
});

function emitAccept() {
  const summonerId = Number(process.env.LOBBY_TEST_SUMMONER_ID || 0);
  const gameName = process.env.LOBBY_TEST_GAME_NAME || "TestPartner";
  const tagLine = process.env.LOBBY_TEST_TAG || "EUW";
  const payload = {
    summonerId,
    gameName,
    tagLine,
    requester: { summonerId, gameName, tagLine },
  };
  console.log(`[repl] emitting join.accepted`, payload);
  syncNs.emit("join.accepted", payload);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", (line) => {
  const cmd = line.trim().toLowerCase();
  if (cmd === "accept") emitAccept();
  else if (cmd === "help") console.log("commands: accept | help");
  else if (cmd) console.log(`unknown: ${cmd} (try accept)`);
});

httpServer.listen(PORT, () => {
  console.log(`LOBLY mock backend http://localhost:${PORT}`);
  console.log(`  POST /v1/auth/dev-login`);
  console.log(`  GET  /config/lcu-endpoints`);
  console.log(`  socket.io /sync`);
  console.log(`  stdin: type "accept" to emit join.accepted`);
  console.log(
    `  set LOBBY_TEST_SUMMONER_ID / LOBBY_TEST_GAME_NAME / LOBBY_TEST_TAG for invite target`
  );
});
