import https from "node:https";
import { WebSocket } from "ws";

// The LCU's cert is self-signed and local-only (127.0.0.1). Disabling
// verification here is a deliberate, dev-tool-only exception — never do
// this for anything that leaves localhost. See 00_BUILD_OVERVIEW.md C2.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export const ENDPOINTS = {
  currentSummoner: { method: "GET", path: "/lol-summoner/v1/current-summoner" },
  gameflowPhase: { method: "GET", path: "/lol-gameflow/v1/gameflow-phase" },
  lobby: { method: "GET", path: "/lol-lobby/v2/lobby" },
  lobbyMembers: { method: "GET", path: "/lol-lobby/v2/lobby/members" },
  sendInvite: { method: "POST", path: "/lol-lobby/v2/lobby/invitations" },
  receivedInvitations: { method: "GET", path: "/lol-lobby/v2/received-invitations" },
  friends: { method: "GET", path: "/lol-chat/v1/friends" },
  acceptInvitation: {
    method: "POST",
    path: (invitationId) => `/lol-lobby/v2/received-invitations/${invitationId}/accept`,
  },
};

export class LcuClient {
  constructor({ port, token }) {
    this.port = port;
    this.token = token;
    this.ws = null;
  }

  request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          host: "127.0.0.1",
          port: this.port,
          path: urlPath,
          method,
          agent: insecureAgent,
          headers: {
            Authorization: `Basic ${this.token}`,
            ...(payload ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 404 && method === "GET") return resolve(null);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              if (!data) return resolve(undefined);
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(data);
              }
              return;
            }
            reject(new Error(`LCU ${method} ${urlPath} -> ${res.statusCode}: ${data}`));
          });
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  /**
   * Proves out C13's escape hatch: Node's `ws` client CAN set the
   * Authorization header on the WebSocket handshake (unlike a browser
   * WebSocket), so the LCU's WAMP event stream is fully reachable here.
   */
  connectEvents(onEvent, { onOpen, onClose } = {}) {
    this.ws = new WebSocket(`wss://127.0.0.1:${this.port}/`, {
      headers: { Authorization: `Basic ${this.token}` },
      rejectUnauthorized: false,
    });

    this.ws.on("open", () => {
      for (const evt of [
        "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
        "OnJsonApiEvent_lol-lobby_v2_lobby",
        "OnJsonApiEvent_lol-lobby_v2_received-invitations",
      ]) {
        this.ws.send(JSON.stringify([5, evt]));
      }
      onOpen?.();
    });

    this.ws.on("message", (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return; // non-JSON keepalive frame
      }
      const [opcode, name, evt] = parsed;
      if (opcode === 8) onEvent(name, evt);
    });

    this.ws.on("close", () => onClose?.());
    this.ws.on("error", (err) => console.error("[ws] error:", err.message));

    return this.ws;
  }

  close() {
    this.ws?.close();
  }
}
