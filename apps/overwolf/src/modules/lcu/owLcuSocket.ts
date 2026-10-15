import type { LcuBusEvent } from "@lobly/client-core";
import { appStore } from "@lobly/client-core";
import { getCreds, hasCreds } from "./credentials";
import { getEndpoint, getEndpointMap } from "./endpoints";

type Emit = (evt: LcuBusEvent, data: unknown) => void;

const HEARTBEAT_MS = 20_000;
/** No successful send for this long → treat the socket as dead. */
const DEAD_AFTER_MS = 65_000;
const MAX_BACKOFF_MS = 30_000;

/** lcu-endpoints name → bus event, for every push feed the tracker consumes. */
const FEEDS: [endpoint: string, event: LcuBusEvent][] = [
  ["gameflowPhase", "phase"],
  ["gameflowSession", "gameflowSession"],
  ["champSelectSession", "champSelect"],
  ["lobby", "lobby"],
];

/**
 * The LCU's WAMP WebSocket from inside Overwolf.
 *
 * A browser `WebSocket` can't send the Basic-auth header the LCU requires
 * (00_BUILD_OVERVIEW.md C13), which is why this host used to be GEP-only.
 * `overwolf.web.createWebSocket` takes the credentials directly and skips
 * certificate checks for 127.0.0.1 — the same API Mobalytics uses for its
 * LCU connection (04_LOBBY_SYNC_AND_POSTGAME.md §1.3 F1).
 *
 * Liveness: Overwolf's socket has no ping/pong events, so every
 * HEARTBEAT_MS we send a harmless `[0]` frame and treat a successful send
 * callback as proof of life; DEAD_AFTER_MS without one forces a reconnect.
 */
export class OwLcuSocket {
  private ws: overwolf.web.WebSocket | null = null;
  /** Bumped per connection attempt; callbacks from older sockets are ignored. */
  private generation = 0;
  private stopped = true;
  private connected = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastAlive = 0;

  constructor(
    private emit: Emit,
    /** Runs after every (re)subscribe — the socket only carries changes. */
    private onSubscribed?: () => void
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  start() {
    this.stopped = false;
    if (!this.ws && !this.reconnectTimer) this.connect();
  }

  stop() {
    this.stopped = true;
    this.teardown();
  }

  /** Credentials rotated: drop the current socket and connect fresh. */
  restart() {
    this.teardown();
    this.backoff = 1000;
    if (!this.stopped) this.connect();
  }

  private teardown() {
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.setConnected(false);
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    appStore.update({ wsAvailable: v });
    appStore.logLine(v ? "LCU WebSocket connected (overwolf.web)" : "LCU WebSocket disconnected");
  }

  private connect() {
    if (this.stopped || !hasCreds()) return;
    const { port, token } = getCreds();
    let password = "";
    try {
      password = atob(token).split(":")[1] ?? "";
    } catch {
      appStore.logLine("LCU WebSocket: could not decode credentials");
      return;
    }

    const gen = ++this.generation;
    overwolf.web.createWebSocket(
      {
        secured: true,
        port: Number(port),
        credentials: { username: "riot", password },
        protocols: ["wamp"],
      },
      (res) => {
        if (gen !== this.generation) {
          res.client?.close();
          return;
        }
        if (!res.success || !res.client) {
          appStore.logLine(`LCU WebSocket create failed: ${res.error ?? "unknown"}`);
          this.scheduleReconnect();
          return;
        }
        const ws = res.client;
        this.ws = ws;
        ws.onOpen.addListener(() => {
          if (gen === this.generation) this.handleOpen(ws);
        });
        ws.onMessage.addListener((e) => {
          if (gen === this.generation) this.handleMessage(e.message);
        });
        ws.onError.addListener((e) => {
          if (gen === this.generation) appStore.logLine(`LCU WebSocket error: ${e?.message ?? ""}`);
        });
        ws.onClosed.addListener(() => {
          if (gen !== this.generation) return;
          this.ws = null;
          this.stopHeartbeat();
          this.setConnected(false);
          this.scheduleReconnect();
        });
        ws.connect((r) => {
          if (gen !== this.generation || r.success) return;
          appStore.logLine(`LCU WebSocket connect failed: ${r.error ?? "unknown"}`);
          this.teardown();
          this.scheduleReconnect();
        });
      }
    );
  }

  private handleOpen(ws: overwolf.web.WebSocket) {
    this.backoff = 1000;
    this.setConnected(true);
    const events = getEndpointMap().wsEvents;
    for (const [name] of FEEDS) {
      const evt = events[name];
      if (evt) ws.send(JSON.stringify([5, evt]), () => undefined);
    }
    this.startHeartbeat(ws);
    this.onSubscribed?.();
  }

  private handleMessage(message: string) {
    let frame: unknown;
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame[0] !== 8) return;
    this.lastAlive = Date.now();
    const evt = frame[2] as { data?: unknown; eventType?: string; uri?: string };
    // Exact URI match only: subscriptions also deliver sub-resources
    // (…/lobby/members, …/champ-select/v1/session/timer) whose payloads are
    // not the parent object (handoff §6.9).
    const busEvent = evt?.uri ? this.uriToEvent().get(evt.uri) : undefined;
    if (!busEvent) return;
    const payload = evt?.eventType === "Delete" ? null : evt?.data;
    this.emit(busEvent, payload);
  }

  /** Built per message so a remotely refreshed endpoint map takes effect. */
  private uriToEvent(): Map<string, LcuBusEvent> {
    const m = new Map<string, LcuBusEvent>();
    for (const [name, event] of FEEDS) {
      try {
        m.set(getEndpoint(name).path, event);
      } catch {
        /* endpoint missing from an older remote map */
      }
    }
    return m;
  }

  private startHeartbeat(ws: overwolf.web.WebSocket) {
    this.stopHeartbeat();
    this.lastAlive = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastAlive > DEAD_AFTER_MS) {
        appStore.logLine("LCU WebSocket heartbeat lost — reconnecting");
        this.teardown();
        this.scheduleReconnect();
        return;
      }
      ws.send("[0]", (r) => {
        if (r?.success) this.lastAlive = Date.now();
      });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
