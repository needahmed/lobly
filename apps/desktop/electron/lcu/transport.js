import https from "node:https";
import { WebSocket } from "ws";
import endpointMap from "@lobly/lcu-endpoints";
// Local-only, self-signed LCU cert (127.0.0.1). Never disable verification
// for anything beyond localhost. See 00_BUILD_OVERVIEW.md C2.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });
const ENDPOINTS = endpointMap;
/**
 * Exact URIs the WAMP subscriptions are allowed to deliver, and the bus event
 * each one feeds. Anything else on the socket (sub-resources such as
 * /lol-lobby/v2/lobby/members or /lol-champ-select/v1/session/timer) is
 * dropped — see the exact-match note in the message handler.
 */
const URI_TO_EVENT = new Map([
    [ENDPOINTS.endpoints.gameflowPhase.path, "phase"],
    [ENDPOINTS.endpoints.gameflowSession.path, "gameflowSession"],
    [ENDPOINTS.endpoints.champSelectSession.path, "champSelect"],
    [ENDPOINTS.endpoints.lobby.path, "lobby"],
]);
/**
 * Electron's LCU access: plain Node https + the `ws` package, which (unlike
 * a browser WebSocket) can set the Authorization header on the handshake.
 * This is the same approach proven live in tools/lcu-standalone — no GEP
 * workaround (C13) is needed here at all.
 */
export class ElectronLcuTransport {
    creds;
    constructor(creds) {
        this.creds = creds;
    }
    request(name, opts = {}) {
        const def = ENDPOINTS.endpoints[name];
        if (!def)
            return Promise.reject(new Error(`Unknown LCU endpoint: ${name}`));
        let urlPath = def.path;
        for (const [k, v] of Object.entries(opts.params ?? {})) {
            urlPath = urlPath.replace(`{${k}}`, encodeURIComponent(v));
        }
        return this.rawRequest(def.method, urlPath, opts.body, opts.retries ?? 2);
    }
    rawRequest(method, urlPath, body, retriesLeft) {
        const payload = body !== undefined ? JSON.stringify(body) : undefined;
        return new Promise((resolve, reject) => {
            const req = https.request({
                host: "127.0.0.1",
                port: this.creds.port,
                path: urlPath,
                method,
                agent: insecureAgent,
                headers: {
                    Authorization: `Basic ${this.creds.token}`,
                    ...(payload ? { "Content-Type": "application/json" } : {}),
                },
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    const status = res.statusCode ?? 0;
                    if (status === 404 && method === "GET")
                        return resolve(null);
                    if (status >= 200 && status < 300) {
                        if (!data)
                            return resolve(undefined);
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(data);
                        }
                        return;
                    }
                    const retriable = status === 429 || status >= 500;
                    if (retriable && retriesLeft > 0) {
                        setTimeout(() => this.rawRequest(method, urlPath, body, retriesLeft - 1).then(resolve, reject), 300 * 2 ** (2 - retriesLeft));
                        return;
                    }
                    reject(new Error(`LCU ${method} ${urlPath} -> ${status}: ${data}`));
                });
            });
            req.on("error", (e) => {
                if (retriesLeft > 0) {
                    setTimeout(() => this.rawRequest(method, urlPath, body, retriesLeft - 1).then(resolve, reject), 300);
                }
                else {
                    reject(e);
                }
            });
            if (payload)
                req.write(payload);
            req.end();
        });
    }
}
/**
 * Push-based event bus over the LCU's own WAMP WebSocket. Since this is a
 * real Node WebSocket (headers allowed), it needs none of the GEP-driven
 * indirection Overwolf requires — lobby updates arrive already-formed, so
 * notifyLobbySignal() is intentionally left unimplemented.
 */
export class ElectronLcuEventBus {
    getCreds;
    onSubscribed;
    ws = null;
    handlers = new Map();
    backoff = 1000;
    stopped = true;
    reconnectTimer = null;
    /**
     * @param onSubscribed runs after every (re)subscribe — the socket only
     *   carries changes, so the caller re-reads current state here.
     */
    constructor(getCreds, onSubscribed) {
        this.getCreds = getCreds;
        this.onSubscribed = onSubscribed;
    }
    on(evt, handler) {
        if (!this.handlers.has(evt))
            this.handlers.set(evt, new Set());
        this.handlers.get(evt).add(handler);
    }
    start() {
        this.stopped = false;
        this.connect();
    }
    stop() {
        this.stopped = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.ws?.close();
        this.ws = null;
    }
    emit(evt, data) {
        this.handlers.get(evt)?.forEach((h) => h(data));
    }
    connect() {
        if (this.stopped)
            return;
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
                this.ws.send(JSON.stringify([5, evt]));
            }
            this.onSubscribed?.();
        });
        this.ws.on("message", (raw) => {
            let frame;
            try {
                frame = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (!Array.isArray(frame) || frame[0] !== 8)
                return;
            const evt = frame[2];
            // Match the URI EXACTLY. A subscription to /lol-lobby/v2/lobby also
            // delivers its sub-resources (…/members, …/invitations), whose
            // payloads are not lobby objects — matching loosely lets those
            // clobber the real lobby with a shape that has no queueId.
            const busEvent = evt?.uri ? URI_TO_EVENT.get(evt.uri) : undefined;
            if (!busEvent)
                return;
            // A Delete event means the resource is gone; its `data` may still echo
            // the last known value, so normalize it to null.
            const payload = evt?.eventType === "Delete" ? null : evt?.data;
            this.emit(busEvent, payload);
        });
        this.ws.on("close", () => {
            this.ws = null;
            if (!this.stopped)
                this.scheduleReconnect();
        });
        this.ws.on("error", () => {
            /* close handler schedules the reconnect */
        });
    }
    scheduleReconnect() {
        if (this.stopped)
            return;
        const delay = this.backoff;
        this.backoff = Math.min(this.backoff * 2, 30_000);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
}
