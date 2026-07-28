import { getCreds, hasCreds } from "./credentials";
import { getWsEvent } from "./endpoints";
import { appStore } from "@lobly/client-core";

type Handler = (data: unknown) => void;

/**
 * Optional WAMP WebSocket client. Only used if the Milestone 2 spike passes.
 * Browser WebSocket cannot set Authorization headers (C13).
 */
export class LcuWsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<"phase" | "lobby", Set<Handler>>();
  private backoff = 1000;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  on(evt: "phase" | "lobby", handler: Handler) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt)!.add(handler);
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private emit(evt: "phase" | "lobby", data: unknown) {
    this.handlers.get(evt)?.forEach((h) => h(data));
  }

  private connect() {
    if (this.stopped || !hasCreds()) return;
    const { port, token } = getCreds();
    let password = "";
    try {
      password = atob(token).split(":")[1] ?? "";
    } catch {
      appStore.logLine("WS: failed to decode token");
      return;
    }

    // Attempt A: embedded credentials (may work in Overwolf CEF)
    const url = `wss://riot:${encodeURIComponent(password)}@127.0.0.1:${port}/`;
    try {
      this.ws = new WebSocket(url, "wamp");
    } catch (e: any) {
      appStore.logLine(`WS construct failed: ${e?.message ?? e}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoff = 1000;
      appStore.update({ wsAvailable: true });
      appStore.logLine("LCU WebSocket connected");
      const phaseEvt = getWsEvent("gameflowPhase");
      const lobbyEvt = getWsEvent("lobby");
      if (phaseEvt) this.ws!.send(JSON.stringify([5, phaseEvt]));
      if (lobbyEvt) this.ws!.send(JSON.stringify([5, lobbyEvt]));
    };

    this.ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(String(ev.data));
        if (!Array.isArray(frame) || frame[0] !== 8) return;
        const name = String(frame[1] ?? "");
        const payload = frame[2]?.data;
        if (name.includes("gameflow-phase")) this.emit("phase", payload);
        else if (name.includes("lobby")) this.emit("lobby", payload);
      } catch {
        /* ignore malformed */
      }
    };

    this.ws.onerror = () => {
      appStore.logLine("LCU WebSocket error");
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
