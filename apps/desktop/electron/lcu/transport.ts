import https from "node:https";
import { WebSocket } from "ws";
import type { LcuTransport, CoreEventBus, LcuBusEvent } from "@lobly/client-core";
import endpointMap from "@lobly/lcu-endpoints";

// Local-only, self-signed LCU cert (127.0.0.1). Never disable verification
// for anything beyond localhost. See 00_BUILD_OVERVIEW.md C2.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

interface Endpoints {
  endpoints: Record<string, { method: string; path: string }>;
  wsEvents: Record<string, string>;
}
const ENDPOINTS = endpointMap as unknown as Endpoints;

/**
 * Exact URIs the WAMP subscriptions are allowed to deliver, and the bus event
 * each one feeds. Anything else on the socket (sub-resources such as
 * /lol-lobby/v2/lobby/members or /lol-champ-select/v1/session/timer) is
 * dropped — see the exact-match note in the message handler.
 */
const URI_TO_EVENT = new Map<string, LcuBusEvent>([
  [ENDPOINTS.endpoints.gameflowPhase.path, "phase"],
  [ENDPOINTS.endpoints.gameflowSession.path, "gameflowSession"],
  [ENDPOINTS.endpoints.champSelectSession.path, "champSelect"],
  [ENDPOINTS.endpoints.lobby.path, "lobby"],
]);

export interface ElectronCreds {
  port: string;
  token: string;
}

/**
 * Electron's LCU access: plain Node https + the `ws` package, which (unlike
 * a browser WebSocket) can set the Authorization header on the handshake.
 * This is the same approach proven live in tools/lcu-standalone — no GEP
 * workaround (C13) is needed here at all.
 */
export class ElectronLcuTransport implements LcuTransport {
  constructor(private creds: ElectronCreds) {}

  request<T>(
    name: string,
    opts: { params?: Record<string, string>; body?: unknown; retries?: number } = {}
  ): Promise<T> {
    const def = ENDPOINTS.endpoints[name];
    if (!def) return Promise.reject(new Error(`Unknown LCU endpoint: ${name}`));
    let urlPath = def.path;
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      urlPath = urlPath.replace(`{${k}}`, encodeURIComponent(v));
    }
    return this.rawRequest<T>(def.method, urlPath, opts.body, opts.retries ?? 2);
  }

  private rawRequest<T>(
    method: string,
    urlPath: string,
    body: unknown,
    retriesLeft: number
  ): Promise<T> {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: "127.0.0.1",
          port: this.creds.port,
          path: urlPath,
          method,
          agent: insecureAgent,
          headers: {
            Authorization: `Basic ${this.creds.token}`,
            ...(payload ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            const status = res.statusCode ?? 0;
            if (status === 404 && method === "GET") return resolve(null as T);
            if (status >= 200 && status < 300) {
              if (!data) return resolve(undefined as T);
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(data as unknown as T);
              }
              return;
            }
            const retriable = status === 429 || status >= 500;
            if (retriable && retriesLeft > 0) {
              setTimeout(
                () =>
                  this.rawRequest<T>(method, urlPath, body, retriesLeft - 1).then(
                    resolve,
                    reject
                  ),
                300 * 2 ** (2 - retriesLeft)
              );
              return;
            }
            reject(new Error(`LCU ${method} ${urlPath} -> ${status}: ${data}`));
          });
        }
      );
      req.on("error", (e) => {
        if (retriesLeft > 0) {
          setTimeout(
            () =>
              this.rawRequest<T>(method, urlPath, body, retriesLeft - 1).then(
                resolve,
                reject
              ),
            300
          );
        } else {
          reject(e);
        }
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

type Handler = (data: unknown) => void;

/**
 * Push-based event bus over the LCU's own WAMP WebSocket. Since this is a
 * real Node WebSocket (headers allowed), it needs none of the GEP-driven
 * indirection Overwolf requires — lobby updates arrive already-formed, so
 * notifyLobbySignal() is intentionally left unimplemented.
 */
export class ElectronLcuEventBus implements CoreEventBus {
  private ws: WebSocket | null = null;
  private handlers = new Map<LcuBusEvent, Set<Handler>>();
  private backoff = 1000;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param onSubscribed runs after every (re)subscribe — the socket only
   *   carries changes, so the caller re-reads current state here.
   */
  constructor(
    private getCreds: () => ElectronCreds | null,
    private onSubscribed?: () => void
  ) {}

  on(evt: LcuBusEvent, handler: Handler) {
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

  private emit(evt: LcuBusEvent, data: unknown) {
    this.handlers.get(evt)?.forEach((h) => h(data));
  }

  private connect() {
    if (this.stopped) return;
    const creds = this.getCreds();
    if (!creds) {
      this.scheduleReconnect();
      return;
    }

    this.ws = new WebSocket(`wss://127.0.0.1:${creds.port}/`, {
      headers: { Authorization: `Basic ${creds.token}` },
      rejectUnauthorized: false,
    });

    this.ws.on("open", () => {
      this.backoff = 1000;
      for (const evt of Object.values(ENDPOINTS.wsEvents)) {
        this.ws!.send(JSON.stringify([5, evt]));
      }
      this.onSubscribed?.();
    });

    this.ws.on("message", (raw) => {
      let frame: unknown;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(frame) || frame[0] !== 8) return;
      const evt = frame[2] as { data?: unknown; eventType?: string; uri?: string };
      // Match the URI EXACTLY. A subscription to /lol-lobby/v2/lobby also
      // delivers its sub-resources (…/members, …/invitations), whose
      // payloads are not lobby objects — matching loosely lets those
      // clobber the real lobby with a shape that has no queueId.
      const busEvent = evt?.uri ? URI_TO_EVENT.get(evt.uri) : undefined;
      if (!busEvent) return;
      // A Delete event means the resource is gone; its `data` may still echo
      // the last known value, so normalize it to null.
      const payload = evt?.eventType === "Delete" ? null : evt?.data;
      this.emit(busEvent, payload);
    });

    this.ws.on("close", () => {
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      /* close handler schedules the reconnect */
    });
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
