import {
  isGameflowPhase,
  isInGamePhase,
  isLegalTransition,
  type GameContext,
  type GameflowPhase,
  type PartyState,
  type PhaseEdge,
} from "@lobly/shared-types";
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
}

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

  constructor(private deps: TrackerDeps = {}) {}

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

  /** Waits for everything ingested so far (tests, seeding). */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** LCU went away: forget everything so the next connection replays cleanly. */
  reset(): Promise<void> {
    return this.queue.push(() => {
      this.lastRaw.clear();
      this.lastPhase = null;
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
      this.lastPhase = next.phase;
      this.emitPhase({
        from,
        to: next.phase,
        legal: isLegalTransition(from, next.phase),
        state: next,
      });
    }
    this.maybeStartGame(next);
  }

  private maybeStartGame(s: PartyState) {
    if (!isInGamePhase(s.phase) || s.gameId == null) return;
    if (this.gameContext?.gameId === s.gameId) return;
    const ctx: GameContext = {
      gameId: s.gameId,
      queueId: s.queueId,
      partyId: s.partyId,
      memberPuuids: s.members.map((m) => m.puuid).filter(Boolean),
      startedAt: this.now(),
    };
    this.gameContext = ctx;
    this.log(`tracker: game ${ctx.gameId} started (queue ${ctx.queueId ?? "?"})`);
    for (const fn of this.gameListeners) safe(() => fn(ctx), this.deps.log);
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
    for (const fn of this.phaseListeners) safe(() => fn(edge), this.deps.log);
  }
}

function safe(fn: () => void, log?: (l: string) => void) {
  try {
    fn();
  } catch (e: any) {
    log?.(`tracker listener threw: ${e?.message ?? e}`);
  }
}

export const gameFlowTracker = new GameFlowTracker();
