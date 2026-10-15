import type { GameflowPhase } from "./listing";
import type { Role } from "./profile";

/**
 * One member of the user's OWN League party (the people in their client
 * lobby). Never contains champ-select strangers — see
 * 04_LOBBY_SYNC_AND_POSTGAME.md §3.1.
 */
export interface PartyMember {
  /** LCU lobby member puuid (the client's local UUID, see handoff §4.1). */
  puuid: string;
  summonerId: number;
  /** gameName#tagLine as shown in the lobby, if the client exposed it. */
  riotId: string | null;
  isLeader: boolean;
  isLocal: boolean;
  /** Lobby position preferences, primary first. [] = fill / unselected. */
  roles: Role[];
  ready?: boolean;
  /** Champ select only, and only for cells matched to a known party member. */
  champSelect?: { assignedRole: Role | null; championLocked: boolean };
}

export interface PartyState {
  phase: GameflowPhase;
  queueId: number | null;
  gameMode: string | null;
  partyId: string | null;
  /** gameflow session gameData.gameId once the game exists, else null. */
  gameId: number | null;
  members: PartyMember[];
  maxLobbySize: number | null;
  positional: boolean;
  /** Positional queues only: roles held by party members. */
  filledRoles: Role[];
  /** Positional queues only: roles nobody in the party holds yet. */
  openRoles: Role[];
  observedAt: number;
}

/** Frozen when a game starts; the input for the end-of-game loop (M3). */
export interface GameContext {
  gameId: number;
  queueId: number | null;
  partyId: string | null;
  memberPuuids: string[];
  startedAt: number;
}

export interface PhaseEdge {
  from: GameflowPhase | null;
  to: GameflowPhase;
  /** False when the edge is not in FLOW_TRANSITIONS (flap / out of order). */
  legal: boolean;
  state: PartyState;
}
