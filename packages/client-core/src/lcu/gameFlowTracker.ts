import {
  SocketEvents,
  isEndOfGamePhase,
  isGameflowPhase,
  isInGamePhase,
  isLegalTransition,
  type GameContext,
  type GameflowPhase,
  type PartyState,
  type PhaseEdge,
} from "@lobly/shared-types";
import { getHostAdapter } from "../hostAdapter";
import { syncAgent } from "../sync/syncAgent";
import { appStore } from "../state/store";
import { SerialQueue } from "./serialQueue";
import {
  emptyParty,
  isLobbyShaped,
  reduceChampSelect,
  reduceGameflowSession,
  reduceLobby,
  reducePhase,
  samePartyState,
} from "./partyReducer";

export type TrackerInput = "phase" | "lobby" | "gameflowSession" | "champSelect";

/** LCU endpoint (lcu-endpoints name) to re-read when a pushed payload is unusable. */
const REST_FALLBACK: Record<TrackerInput, string> = {
  phase: "gameflowPhase",
  lobby: "lobby",
  gameflowSession: "gameflowSession",
  champSelect: "champSelectSession",
};

export interface TrackerDeps {
  /** One LCU REST read by endpoint name; GET 404 resolves null. */
  fetch?: (endpoint: string) => Promise<unknown>;
  log?: (line: string) => void;
  now?: () => number;
  /** Override the socket send (tests). Defaults to the sync agent. */
  send?: (event: string, payload: unknown) => void;
  /** EOG gameId fallback budget. Production is 60 × 1s. */
  eogAttempts?: number;
  eogDelayMs?: number;
}

const GAME_CONTEXT_KEY = "lobly.gameContext";
const LAST_ENDED_KEY = "lobly.lastEndedGameId";

type PartyListener = (state: PartyState) => void;
type PhaseListener = (edge: PhaseEdge) => void;
type GameListener = (ctx: GameContext) => void;

/**
 * Single pipeline for every LCU push and REST read (04 doc §3.2.2):
 *
 *   raw event → serial queue → per-input dedupe → validate (REST re-read on
 *   failure) → reduce → emit "party" on change / "phase" on a phase change
 *
 * Phase listeners get every real phase CHANGE once (repeats from GEP + WS
 * are dropped). `edge.legal` says whether the change is in FLOW_TRANSITIONS;
 * once-per-game hooks must check it, the listing machine does not need to.
 */
export class GameFlowTracker {
  private queue = new SerialQueue();
  private state: PartyState = emptyParty();
  private lastRaw = new Map<TrackerInput, string>();
  private gameContext: GameContext | null = null;
  private partyListeners = new Set<PartyListener>();
  private phaseListeners = new Set<PhaseListener>();
  private gameListeners = new Set<GameListener>();
  /** Last phase actually observed (null until the first one arrives). */
  private lastPhase: GameflowPhase | null = null;
  /** One ready-check accept attempt per visit to ReadyCheck. Not retried. */
  private readyCheckAttempted = false;
  private readyCheckTimer: ReturnType<typeof setTimeout> | null = null;
  /** True after a legal entry into GameStart / InProgress. */
  private inGameEntryLegal = false;
  private lastEndedGameId: number | null = null;
  private lastEndedWasError = false;
  private lastShownGameId: number | null = null;
  private awaitingErrorResolution = false;
  /** Launcher died mid-game; send game.ended only after we know how it finished. */
  private deferredTermination = false;
  private localEog: LocalEog | null = null;

  constructor(private deps: TrackerDeps = {}) {
    this.gameContext = readStoredContext();
    this.lastEndedGameId = readLastEnded();
  }

  configure(deps: TrackerDeps) {
    this.deps = { ...this.deps, ...deps };
  }

  getState(): PartyState {
    return this.state;
  }

  getGameContext(): GameContext | null {
    return this.gameContext;
  }

  onParty(fn: PartyListener): () => void {
    this.partyListeners.add(fn);
    return () => this.partyListeners.delete(fn);
  }

  onPhase(fn: PhaseListener): () => void {
    this.phaseListeners.add(fn);
    return () => this.phaseListeners.delete(fn);
  }

  /** Fires once per gameId, when a game is first seen in progress. */
  onGameStarted(fn: GameListener): () => void {
    this.gameListeners.add(fn);
    return () => this.gameListeners.delete(fn);
  }

  ingest(input: TrackerInput, data: unknown): Promise<void> {
    return this.queue.push(() => this.process(input, data));
  }

  /**
   * League closed while a game was in progress. Keep GameContext and wait
   * until the client comes back before deciding the game ended.
   */
  noteLauncherClosed() {
    if (this.gameContext && this.lastEndedGameId !== this.gameContext.gameId) {
      this.deferredTermination = true;
      this.log("tracker: launcher closed during a game — deferring game.ended");
    }
  }

  /** Waits for everything ingested so far (tests, seeding). */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** LCU went away: forget everything so the next connection replays cleanly. */
  reset(): Promise<void> {
    return this.queue.push(() => {
      if (this.readyCheckTimer) clearTimeout(this.readyCheckTimer);
      this.readyCheckTimer = null;
      this.readyCheckAttempted = false;
      this.lastRaw.clear();
      this.lastPhase = null;
      this.inGameEntryLegal = false;
      const prev = this.state;
      this.state = emptyParty();
      if (!samePartyState(prev, this.state)) this.emitParty();
    });
  }

  private log(line: string) {
    this.deps.log?.(line);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async process(input: TrackerInput, data: unknown): Promise<void> {
    // Byte-identical repeats of the chatty feeds are dropped before any work.
    // Phase-bearing inputs skip this: "phase" and "gameflowSession" both carry
    // the phase, so a repeat on one can still be news after the other moved
    // it — their reducers are idempotent instead.
    if (input === "lobby" || input === "champSelect") {
      let raw: string;
      try {
        raw = JSON.stringify(data ?? null);
      } catch {
        return;
      }
      if (this.lastRaw.get(input) === raw) return;
      this.lastRaw.set(input, raw);
    }

    let payload = data;
    if (!this.isValid(input, payload)) {
      payload = await this.refetch(input);
      if (!this.isValid(input, payload)) {
        this.log(`tracker: dropped unusable ${input} payload`);
        return;
      }
    }

    const prev = this.state;
    const now = this.now();
    let next = prev;
    switch (input) {
      case "phase":
        next = reducePhase(prev, payload as GameflowPhase, now);
        break;
      case "lobby":
        next = reduceLobby(prev, payload, now);
        break;
      case "champSelect":
        next = reduceChampSelect(prev, payload, now);
        break;
      case "gameflowSession": {
        const r = reduceGameflowSession(prev, payload, now);
        if (r.kind === "stale") {
          this.log(`tracker: ignored stale gameflow session (${r.reason})`);
          return;
        }
        if (r.kind === "invalid") return;
        next = r.state;
        break;
      }
    }

    this.state = next;
    if (!samePartyState(prev, next)) this.emitParty();

    const phaseBearing = input === "phase" || input === "gameflowSession";
    if (phaseBearing && next.phase !== this.lastPhase) {
      const from = this.lastPhase;
      const legal = isLegalTransition(from, next.phase);
      this.lastPhase = next.phase;
      if (legal && isInGamePhase(next.phase)) this.inGameEntryLegal = true;
      if (!isInGamePhase(next.phase)) this.inGameEntryLegal = false;
      this.emitPhase({ from, to: next.phase, legal, state: next });
      if (legal) await this.onLegalEdge(from, next.phase);
    }
    this.maybeStartGame(next);
  }

  private async onLegalEdge(from: GameflowPhase | null, to: GameflowPhase) {
    if (to === "TerminatedInError") this.awaitingErrorResolution = true;
    if (from === "Reconnect" && to === "InProgress") this.awaitingErrorResolution = false;

    if (isEndOfGamePhase(to)) {
      this.awaitingErrorResolution = false;
      this.deferredTermination = false;
      await this.maybeEndGame(false);
    } else if (this.awaitingErrorResolution && (to === "None" || to === "Lobby")) {
      this.awaitingErrorResolution = false;
      await this.maybeEndGame(true);
    } else if (this.deferredTermination && (to === "None" || to === "Lobby")) {
      this.deferredTermination = false;
      await this.maybeEndGame(true);
    }

    if (to === "EndOfGame") this.maybeOpenPostGame();
    if (to === "Lobby" || to === "Matchmaking") this.collapsePostGame();
  }

  private maybeStartGame(s: PartyState) {
    if (!this.inGameEntryLegal || !isInGamePhase(s.phase) || s.gameId == null) return;
    if (this.gameContext?.gameId === s.gameId) return;
    const ctx: GameContext = {
      gameId: s.gameId,
      queueId: s.queueId,
      partyId: s.partyId,
      memberPuuids: s.members.map((m) => m.puuid).filter(Boolean),
      startedAt: this.now(),
    };
    this.gameContext = ctx;
    persistContext(ctx);
    this.log(`tracker: game ${ctx.gameId} started (queue ${ctx.queueId ?? "?"})`);
    this.sendGame(SocketEvents.GAME_STARTED, {
      gameId: ctx.gameId,
      queueId: ctx.queueId ?? undefined,
      partyId: ctx.partyId,
      memberPuuids: ctx.memberPuuids,
    });
    for (const fn of this.gameListeners) safe(() => fn(ctx), this.deps.log);
  }

  private async maybeEndGame(terminatedInError: boolean) {
    let gameId = this.gameContext?.gameId ?? this.state.gameId;
    if (gameId == null || gameId <= 0) {
      if (terminatedInError) return;
      gameId = await this.resolveEogGameId();
    }
    if (gameId == null || gameId <= 0) {
      this.log("tracker: game ended without a gameId");
      return;
    }
    if (this.lastEndedGameId === gameId && !(this.lastEndedWasError && !terminatedInError)) return;
    this.lastEndedGameId = gameId;
    this.lastEndedWasError = terminatedInError;
    persistLastEnded(gameId);
    const ctx = this.gameContext;
    this.sendGame(SocketEvents.GAME_ENDED, {
      gameId,
      queueId: ctx?.queueId ?? this.state.queueId ?? undefined,
      partyId: ctx?.partyId ?? this.state.partyId,
      memberPuuids: ctx?.memberPuuids ?? this.state.members.map((m) => m.puuid).filter(Boolean),
      endedAt: this.now(),
      terminatedInError,
    });
  }

  private async resolveEogGameId(): Promise<number | null> {
    if (!this.deps.fetch) return null;
    const attempts = this.deps.eogAttempts ?? 60;
    const delay = this.deps.eogDelayMs ?? 1000;
    for (let i = 0; i < attempts; i++) {
      try {
        const block = await this.deps.fetch("eogStatsBlock");
        const parsed = readEog(block);
        if (parsed.local) this.localEog = parsed.local;
        if (parsed.gameId) {
          if (!this.gameContext) {
            this.gameContext = {
              gameId: parsed.gameId,
              queueId: this.state.queueId,
              partyId: this.state.partyId,
              memberPuuids: this.state.members.map((m) => m.puuid).filter(Boolean),
              startedAt: this.now(),
            };
            persistContext(this.gameContext);
          }
          return parsed.gameId;
        }
      } catch (e: any) {
        this.log(`tracker: eog read failed: ${e?.message ?? e}`);
      }
      if (i < attempts - 1 && delay > 0) await sleep(delay);
    }
    return null;
  }

  private maybeOpenPostGame() {
    const gameId = this.gameContext?.gameId ?? this.state.gameId ?? this.lastEndedGameId;
    const hints = appStore.state.profileHints;
    const previous = appStore.state.postGame;
    appStore.update({
      uiTab: "postgame",
      postGame: {
        gameId: gameId ?? null,
        queueId: this.gameContext?.queueId ?? this.state.queueId,
        local: this.localEog ?? previous?.local ?? null,
        ready: previous?.ready && previous.ready.gameId === gameId ? previous.ready : null,
        mode: "full",
        dismissed: false,
        rankBefore: hints
          ? { tier: hints.soloTier ?? null, division: hints.soloDivision ?? null }
          : null,
      },
    });
    if (gameId == null || this.lastShownGameId === gameId) return;
    if (appStore.state.openOnGameEnd === false) return;
    this.lastShownGameId = gameId;
    try {
      getHostAdapter().showWindowInactive?.();
    } catch (e: any) {
      this.log(`tracker: show window failed: ${e?.message ?? e}`);
    }
  }

  private collapsePostGame() {
    const cur = appStore.state.postGame;
    if (!cur || cur.dismissed || cur.mode === "hidden" || cur.mode === "banner") return;
    appStore.update({
      uiTab: appStore.state.uiTab === "postgame" ? "listing" : appStore.state.uiTab,
      postGame: { ...cur, mode: "banner" },
    });
  }

  private sendGame(event: string, payload: Record<string, unknown>) {
    if (appStore.state.flags?.postgameLoop === false) return;
    try {
      if (this.deps.send) this.deps.send(event, payload);
      else syncAgent.send(event, payload);
    } catch (e: any) {
      this.log(`tracker: ${event} not sent: ${e?.message ?? e}`);
    }
  }

  private isValid(input: TrackerInput, data: unknown): boolean {
    switch (input) {
      case "phase":
        return isGameflowPhase(data);
      case "lobby":
        return data == null || isLobbyShaped(data);
      case "gameflowSession":
        return data == null || (typeof data === "object" && isGameflowPhase((data as any).phase));
      case "champSelect":
        return data == null || (typeof data === "object" && Array.isArray((data as any).myTeam));
    }
  }

  private async refetch(input: TrackerInput): Promise<unknown> {
    if (!this.deps.fetch) return undefined;
    try {
      return await this.deps.fetch(REST_FALLBACK[input]);
    } catch (e: any) {
      this.log(`tracker: REST fallback for ${input} failed: ${e?.message ?? e}`);
      return undefined;
    }
  }

  private emitParty() {
    for (const fn of this.partyListeners) safe(() => fn(this.state), this.deps.log);
  }

  private emitPhase(edge: PhaseEdge) {
    this.scheduleReadyCheck(edge.to);
    for (const fn of this.phaseListeners) safe(() => fn(edge), this.deps.log);
  }

  private scheduleReadyCheck(to: GameflowPhase) {
    if (to !== "ReadyCheck") {
      if (this.readyCheckTimer) clearTimeout(this.readyCheckTimer);
      this.readyCheckTimer = null;
      this.readyCheckAttempted = false;
      return;
    }
    if (this.readyCheckAttempted) return;
    const enabled = appStore.state.autoAcceptQueue === true;
    if (!enabled) return;
    this.readyCheckAttempted = true;
    this.readyCheckTimer = setTimeout(() => {
      this.readyCheckTimer = null;
      if (this.state.phase !== "ReadyCheck") return;
      void this.deps
        .fetch?.("readyCheckAccept")
        .then(() => this.log("ready-check auto-accepted"))
        .catch((e: any) =>
          this.log(`ready-check auto-accept failed: ${e?.message ?? e}`)
        );
    }, 1500);
  }
}

interface LocalEog {
  win: boolean | null;
  championId: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  durationSec: number | null;
}

function readStoredContext(): GameContext | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(GAME_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameContext;
    return typeof parsed?.gameId === "number" && parsed.gameId > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function readLastEnded(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const n = Number(localStorage.getItem(LAST_ENDED_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function persistContext(ctx: GameContext | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (!ctx) localStorage.removeItem(GAME_CONTEXT_KEY);
    else localStorage.setItem(GAME_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    /* host storage is best-effort */
  }
}

function persistLastEnded(gameId: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LAST_ENDED_KEY, String(gameId));
  } catch {
    /* ignore */
  }
}

function readEog(block: unknown): { gameId: number | null; local: LocalEog | null } {
  if (!block || typeof block !== "object") return { gameId: null, local: null };
  const b = block as {
    gameId?: number;
    gameLength?: number;
    gameData?: { gameId?: number };
    localPlayer?: { championId?: number; stats?: Record<string, number> };
    teams?: { isPlayerTeam?: boolean; isWinningTeam?: boolean }[];
  };
  const gameId = Number(b.gameId ?? b.gameData?.gameId);
  const stats = b.localPlayer?.stats ?? {};
  const teams = Array.isArray(b.teams) ? b.teams : [];
  const playerTeam = teams.find((t) => t.isPlayerTeam) ?? teams[0];
  const win =
    typeof playerTeam?.isWinningTeam === "boolean"
      ? playerTeam.isWinningTeam
      : stats.WIN
        ? true
        : stats.LOSE
          ? false
          : null;
  return {
    gameId: Number.isFinite(gameId) && gameId > 0 ? gameId : null,
    local: {
      win,
      championId: Number(b.localPlayer?.championId) || null,
      kills: numberOrNull(stats.CHAMPIONS_KILLED),
      deaths: numberOrNull(stats.NUM_DEATHS),
      assists: numberOrNull(stats.ASSISTS),
      durationSec: Number(b.gameLength) || null,
    },
  };
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safe(fn: () => void, log?: (l: string) => void) {
  try {
    fn();
  } catch (e: any) {
    log?.(`tracker listener threw: ${e?.message ?? e}`);
  }
}

export const gameFlowTracker = new GameFlowTracker();
