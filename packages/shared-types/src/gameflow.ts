import type { GameflowPhase } from "./listing";

/**
 * Legal gameflow transitions. The LCU (and GEP alongside it) re-sends,
 * reorders and briefly flaps phases — cancelling queue, dodges, reconnects,
 * two push channels delivering the same change. Hooks that must fire once per
 * real transition (game started / game ended) only fire when the edge is in
 * this table. `null` means "anything may follow" (cold start / idle).
 *
 * Modelled on the transition map Mobalytics ships for the same job; see
 * 04_LOBBY_SYNC_AND_POSTGAME.md §1.3 F3.
 */
export const FLOW_TRANSITIONS: Record<GameflowPhase, GameflowPhase[] | null> = {
  None: null,
  Lobby: ["Matchmaking", "ChampSelect", "None", "CheckedIntoTournament"],
  CheckedIntoTournament: ["Lobby", "ChampSelect", "None"],
  Matchmaking: ["Lobby", "None", "ReadyCheck"],
  ReadyCheck: ["Matchmaking", "Lobby", "None", "ChampSelect", "GameStart", "InProgress"],
  ChampSelect: ["Matchmaking", "GameStart", "InProgress", "None", "Lobby"],
  GameStart: ["InProgress", "TerminatedInError", "WaitingForStats", "PreEndOfGame", "EndOfGame"],
  InProgress: ["TerminatedInError", "WaitingForStats", "PreEndOfGame", "EndOfGame"],
  TerminatedInError: ["Reconnect", "None", "Lobby"],
  Reconnect: ["InProgress", "WaitingForStats", "None", "Lobby"],
  WaitingForStats: ["PreEndOfGame", "EndOfGame", "None", "Lobby"],
  PreEndOfGame: ["WaitingForStats", "EndOfGame", "Lobby", "None"],
  EndOfGame: ["None", "Lobby"],
  WatchInProgress: null,
};

const KNOWN_PHASES = new Set<string>(Object.keys(FLOW_TRANSITIONS));

export function isGameflowPhase(v: unknown): v is GameflowPhase {
  return typeof v === "string" && KNOWN_PHASES.has(v);
}

/**
 * True when prev → next is a real transition worth firing hooks for.
 * A missing prev (cold start) accepts anything; a self-transition never fires.
 */
export function isLegalTransition(
  prev: GameflowPhase | null | undefined,
  next: GameflowPhase
): boolean {
  if (prev === next) return false;
  if (!prev) return true;
  const allowed = FLOW_TRANSITIONS[prev];
  return allowed === null || allowed === undefined || allowed.includes(next);
}

/** Phases during which a game is loading or being played. */
export const IN_GAME_PHASES: readonly GameflowPhase[] = ["GameStart", "InProgress", "Reconnect"];

/** Phases that mean the game is over and stats are pending or shown. */
export const END_OF_GAME_PHASES: readonly GameflowPhase[] = [
  "WaitingForStats",
  "PreEndOfGame",
  "EndOfGame",
];

export function isInGamePhase(p: GameflowPhase | null | undefined): boolean {
  return p != null && IN_GAME_PHASES.includes(p);
}

export function isEndOfGamePhase(p: GameflowPhase | null | undefined): boolean {
  return p != null && END_OF_GAME_PHASES.includes(p);
}

/**
 * Phases where the stale-event guard applies: a gameflow session whose queue
 * id disagrees with the current one is a late echo of the previous queue.
 */
export const QUEUE_LOCKED_PHASES: readonly GameflowPhase[] = [
  "ChampSelect",
  "GameStart",
  "InProgress",
  "WaitingForStats",
];
