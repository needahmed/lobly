/**
 * The seam between host-agnostic logic (this package) and whatever platform
 * hosts it (Overwolf's GEP + fetch, Electron's Node https/ws, ...). Each host
 * calls configureLoblyCore() exactly once at boot, before touching anything
 * else exported by this package.
 */
export interface LcuTransport {
  request<T>(
    name: string,
    opts?: { params?: Record<string, string>; body?: unknown; retries?: number }
  ): Promise<T>;
}

/**
 * Push events a host may deliver. "phase" and "lobby" are required;
 * "gameflowSession" (/lol-gameflow/v1/session) and "champSelect"
 * (/lol-champ-select/v1/session) are optional richer feeds — a host without
 * them still works, the tracker just learns less (no gameId, no champ-select
 * roles) until refreshLcuState() reads them over REST.
 */
export type LcuBusEvent = "phase" | "lobby" | "gameflowSession" | "champSelect";

export interface CoreEventBus {
  start(): void;
  stop(): void;
  on(evt: LcuBusEvent, handler: (data: unknown) => void): void;
  /** Optional: pull-based hosts (GEP "something changed" signals) use this to
   *  trigger a fresh LCU lobby read. Push-based hosts (Electron's own
   *  poller/WS) can leave it unimplemented. */
  notifyLobbySignal?(): Promise<void>;
}

export interface HostAdapter {
  backendUrl: string;
  lcuTransport: LcuTransport;
  eventBus: CoreEventBus;
  /** Best-effort: is the main UI window hidden/minimized right now? Used to
   *  decide whether an incoming chat message also needs a toast. */
  isDesktopHidden(): Promise<boolean>;
}

let adapter: HostAdapter | null = null;

export function configureLoblyCore(a: HostAdapter) {
  adapter = a;
}

export function getHostAdapter(): HostAdapter {
  if (!adapter) {
    throw new Error(
      "@lobly/client-core: configureLoblyCore() must be called before use"
    );
  }
  return adapter;
}

export function isCoreConfigured(): boolean {
  return adapter !== null;
}

/**
 * For UI-only JS contexts (a browser tab, an Electron renderer) that only
 * ever call the REST api/* helpers (fetchBoard, requestJoin, ...) and never
 * touch the LCU or the listing-machine/sync-agent bus directly — those live
 * in the host's main/background process, a SEPARATE JS context that must
 * configure the real adapter itself. Electron's main and renderer processes
 * in particular do not share module state, so each needs its own call to
 * configureLoblyCore(); the renderer only needs backendUrl to be correct.
 */
export function createNoopHostAdapter(backendUrl: string): HostAdapter {
  return {
    backendUrl,
    lcuTransport: {
      request() {
        return Promise.reject(
          new Error("LCU access is not available from this JS context")
        );
      },
    },
    eventBus: {
      start() {},
      stop() {},
      on() {},
    },
    isDesktopHidden: () => Promise.resolve(false),
  };
}
