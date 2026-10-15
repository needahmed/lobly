import {
  appStore,
  refreshLcuState,
  type CoreEventBus,
  type LcuBusEvent,
} from "@lobly/client-core";
import { lcuRequest } from "./request";
import { hasCreds, onCredsChanged } from "./credentials";
import { OwLcuSocket } from "./owLcuSocket";

type Handler = (data: unknown) => void;

/** Kill switch: localStorage "lobly.owLcuWs" = "off" falls back to GEP + REST only. */
function lcuSocketEnabled(): boolean {
  try {
    return localStorage.getItem("lobly.owLcuWs") !== "off";
  } catch {
    return true;
  }
}

/**
 * Overwolf's LCU event bus. Two sources feed the same handlers:
 *
 *  - the LCU WebSocket via overwolf.web.createWebSocket (primary): phase,
 *    gameflow session, champ select and full lobby objects, pushed;
 *  - GEP (always on, redundant): game_flow phases, plus lobby_info signals
 *    that trigger a REST lobby read while the socket is down.
 *
 * Duplicates between the two are harmless — client-core's GameFlowTracker
 * de-duplicates before anything reaches the listing machine.
 */
export class OverwolfLcuEventBus implements CoreEventBus {
  private handlers = new Map<LcuBusEvent, Set<Handler>>();
  private started = false;
  private socket = new OwLcuSocket(
    (evt, data) => this.emit(evt, data),
    () => void refreshLcuState()
  );

  constructor() {
    onCredsChanged((creds) => {
      if (!this.started || !lcuSocketEnabled()) return;
      if (creds) this.socket.restart();
      else this.socket.stop();
    });
  }

  on(evt: LcuBusEvent, handler: Handler) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt)!.add(handler);
  }

  start() {
    this.started = true;
    if (lcuSocketEnabled()) {
      this.socket.start();
      appStore.logLine("LCU event bus started (WebSocket + GEP)");
    } else {
      appStore.logLine("LCU event bus started (GEP only — owLcuWs off)");
    }
  }

  stop() {
    this.started = false;
    this.socket.stop();
  }

  /** GEP game_flow phase. */
  notifyPhase(phase: unknown) {
    if (!this.started) return;
    this.emit("phase", phase);
  }

  /**
   * GEP lobby_info changed. The socket already pushes full lobby objects, so
   * only fall back to a REST read while it is down.
   */
  async notifyLobbySignal() {
    if (!this.started || !hasCreds() || this.socket.isConnected()) return;
    try {
      const lobby = await lcuRequest<unknown>("lobby");
      this.emit("lobby", lobby);
    } catch (e: any) {
      appStore.logLine(`lobby read failed: ${e?.message ?? e}`);
    }
  }

  private emit(evt: LcuBusEvent, data: unknown) {
    this.handlers.get(evt)?.forEach((h) => h(data));
  }
}

export const lcuEventBus = new OverwolfLcuEventBus();
