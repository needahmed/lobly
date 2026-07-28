import { appStore } from "@lobly/client-core";
import { lcuRequest } from "./request";
import { LcuWsClient } from "./wsClient";
import { hasCreds } from "./credentials";

export interface LcuEventBus {
  start(): void;
  stop(): void;
  on(evt: "phase" | "lobby", handler: (data: unknown) => void): void;
}

type Handler = (data: unknown) => void;

/** Default: GEP-driven. Lobby signals trigger REST reads. */
export class GepEventBus implements LcuEventBus {
  private handlers = new Map<"phase" | "lobby", Set<Handler>>();
  private started = false;

  on(evt: "phase" | "lobby", handler: Handler) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt)!.add(handler);
  }

  start() {
    this.started = true;
    appStore.logLine("GepEventBus started");
  }

  stop() {
    this.started = false;
  }

  /** Called by GEP module when phase changes. */
  notifyPhase(phase: unknown) {
    if (!this.started) return;
    this.handlers.get("phase")?.forEach((h) => h(phase));
  }

  /** Called by GEP when lobby_info changes — fetch full lobby via REST. */
  async notifyLobbySignal() {
    if (!this.started || !hasCreds()) return;
    try {
      const lobby = await lcuRequest<unknown>("lobby");
      this.handlers.get("lobby")?.forEach((h) => h(lobby));
    } catch (e: any) {
      appStore.logLine(`lobby read failed: ${e?.message ?? e}`);
    }
  }
}

/** Optional WS-driven bus — only if spike sets wsAvailable. */
export class WsEventBus implements LcuEventBus {
  private client = new LcuWsClient();
  private handlers = new Map<"phase" | "lobby", Set<Handler>>();

  on(evt: "phase" | "lobby", handler: Handler) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt)!.add(handler);
    this.client.on(evt, handler);
  }

  start() {
    this.client.start();
    appStore.logLine("WsEventBus started");
  }

  stop() {
    this.client.stop();
  }
}

/** Singleton GEP bus — always the primary push channel. */
export const gepEventBus = new GepEventBus();

let activeBus: LcuEventBus = gepEventBus;

export function getEventBus(): LcuEventBus {
  return activeBus;
}

/** Upgrade to WS if spike passed; GEP still feeds phase as redundancy. */
export function enableWsEventBus() {
  const ws = new WsEventBus();
  // re-attach existing gep handlers aren't shared — machine wires after boot
  activeBus = ws;
  ws.start();
  appStore.update({ wsAvailable: true });
  appStore.logLine("Upgraded LcuEventBus → WsEventBus");
  return ws;
}

export function useGepEventBus() {
  activeBus = gepEventBus;
  gepEventBus.start();
}
