import {
  ALL_ROLES,
  QUEUE_LOCKED_PHASES,
  deriveLobbyCapability,
  isGameflowPhase,
  isInGamePhase,
  type GameflowPhase,
  type PartyMember,
  type PartyState,
  type Role,
} from "@lobly/shared-types";

/**
 * Pure reducers from raw LCU payloads to PartyState. No I/O, no store — the
 * GameFlowTracker owns sequencing and side effects. Everything here is
 * limited to the user's OWN party: champ-select cells that don't belong to a
 * known lobby member are ignored, never looked up (04 doc §3.1, F7).
 */

export function emptyParty(): PartyState {
  return {
    phase: "None",
    queueId: null,
    gameMode: null,
    partyId: null,
    gameId: null,
    members: [],
    maxLobbySize: null,
    positional: false,
    filledRoles: [],
    openRoles: [],
    observedAt: 0,
  };
}

const ROLE_ALIASES: Record<string, Role> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MIDDLE",
  MID: "MIDDLE",
  BOTTOM: "BOTTOM",
  BOT: "BOTTOM",
  ADC: "BOTTOM",
  UTILITY: "UTILITY",
  SUPPORT: "UTILITY",
};

/** LCU position string (any case) → Role. FILL / UNSELECTED / "" → null. */
export function toRole(v: unknown): Role | null {
  if (typeof v !== "string") return null;
  return ROLE_ALIASES[v.trim().toUpperCase()] ?? null;
}

function riotIdOf(m: any): string | null {
  const gameName = typeof m?.gameName === "string" ? m.gameName : "";
  const tagLine = typeof m?.tagLine === "string" ? m.tagLine : "";
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  if (typeof m?.summonerName === "string" && m.summonerName) return m.summonerName;
  return null;
}

/** Phases in which a null lobby does NOT mean "the party broke up". */
const PARTY_PERSISTS: readonly GameflowPhase[] = [
  "Matchmaking",
  "ReadyCheck",
  "ChampSelect",
  "GameStart",
  "InProgress",
  "Reconnect",
  "TerminatedInError",
  "WaitingForStats",
  "PreEndOfGame",
  "EndOfGame",
];

function withDerivedRoles(s: PartyState): PartyState {
  if (!s.positional) return { ...s, filledRoles: [], openRoles: [] };
  const filled: Role[] = [];
  for (const m of s.members) {
    const role = m.champSelect?.assignedRole ?? m.roles[0] ?? null;
    if (role && !filled.includes(role)) filled.push(role);
  }
  const ordered = ALL_ROLES.filter((r) => filled.includes(r));
  return {
    ...s,
    filledRoles: ordered,
    openRoles: ALL_ROLES.filter((r) => !filled.includes(r)),
  };
}

export function isLobbyShaped(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const l = v as any;
  return l.gameConfig != null || l.queueId != null || l.partyId != null;
}

/** /lol-lobby/v2/lobby (or null when there is no lobby). */
export function reduceLobby(
  state: PartyState,
  lobby: unknown,
  now = Date.now()
): PartyState {
  if (lobby == null) {
    if (PARTY_PERSISTS.includes(state.phase)) return state;
    return withDerivedRoles({
      ...state,
      partyId: null,
      members: [],
      maxLobbySize: null,
      positional: false,
      observedAt: now,
    });
  }
  if (!isLobbyShaped(lobby)) return state;

  const l = lobby as any;
  const cap = deriveLobbyCapability(l);
  const localPuuid: string | undefined = l.localMember?.puuid;
  const localSummonerId = Number(l.localMember?.summonerId);
  const rawMembers: any[] = Array.isArray(l.members) ? l.members : [];

  const members: PartyMember[] = rawMembers.map((m) => {
    const summonerId = Number(m?.summonerId) || 0;
    const puuid = typeof m?.puuid === "string" ? m.puuid : "";
    const roles = [toRole(m?.firstPositionPreference), toRole(m?.secondPositionPreference)]
      .filter((r): r is Role => r !== null)
      .filter((r, i, arr) => arr.indexOf(r) === i);
    const prev = state.members.find(
      (p) => (puuid && p.puuid === puuid) || (summonerId && p.summonerId === summonerId)
    );
    const member: PartyMember = {
      puuid,
      summonerId,
      riotId: riotIdOf(m),
      isLeader: Boolean(m?.isLeader),
      isLocal:
        (localPuuid != null && puuid === localPuuid) ||
        (Number.isFinite(localSummonerId) && localSummonerId > 0 && summonerId === localSummonerId),
      roles,
    };
    if (typeof m?.ready === "boolean") member.ready = m.ready;
    if (prev?.champSelect) member.champSelect = prev.champSelect;
    return member;
  });

  return withDerivedRoles({
    ...state,
    queueId: cap?.queueId ?? state.queueId,
    gameMode: cap?.gameMode ?? state.gameMode,
    partyId: typeof l.partyId === "string" ? l.partyId : state.partyId,
    members,
    maxLobbySize: cap?.maxLobbySize ?? null,
    positional: cap?.positional ?? false,
    observedAt: now,
  });
}

export type SessionResult =
  | { kind: "applied"; state: PartyState }
  | { kind: "stale"; reason: string }
  | { kind: "invalid" };

/** /lol-gameflow/v1/session. Returns "stale" for late echoes of an old queue. */
export function reduceGameflowSession(
  state: PartyState,
  session: unknown,
  now = Date.now()
): SessionResult {
  if (session == null) {
    // No session at all means the client is idle.
    return { kind: "applied", state: reducePhase(state, "None", now) };
  }
  const s = session as any;
  if (typeof s !== "object" || !isGameflowPhase(s.phase)) return { kind: "invalid" };

  const phase: GameflowPhase = s.phase;
  const queue = s.gameData?.queue;
  const queueId = Number.isFinite(Number(queue?.id)) && queue?.id != null ? Number(queue.id) : null;

  // Stale guard (04 doc F3): while a game is locked in, a session whose
  // queue disagrees with ours is the previous queue's echo — drop it.
  if (
    state.queueId != null &&
    queueId != null &&
    queueId !== state.queueId &&
    QUEUE_LOCKED_PHASES.includes(state.phase) &&
    QUEUE_LOCKED_PHASES.includes(phase)
  ) {
    return { kind: "stale", reason: `queue ${queueId} != ${state.queueId} during ${state.phase}` };
  }

  let next = reducePhase(state, phase, now);
  if (queueId != null) next = { ...next, queueId };
  if (typeof queue?.gameMode === "string" && queue.gameMode) {
    next = { ...next, gameMode: queue.gameMode };
  }

  const gameId = Number(s.gameData?.gameId);
  if (Number.isFinite(gameId) && gameId > 0 && (isInGamePhase(phase) || phase === "ChampSelect")) {
    next = { ...next, gameId };
  }
  return { kind: "applied", state: next };
}

/**
 * A bare phase (GEP game_flow, /gameflow-phase). Keeps gameId through the
 * end-of-game phases; drops it once the client is back to idle/lobby so the
 * next game starts clean.
 */
export function reducePhase(
  state: PartyState,
  phase: GameflowPhase,
  now = Date.now()
): PartyState {
  if (state.phase === phase) return state;
  const clearsGame = phase === "None" || phase === "Lobby" || phase === "Matchmaking";
  const leavesChampSelect = !isInGamePhase(phase) && phase !== "ChampSelect";
  return withDerivedRoles({
    ...state,
    phase,
    gameId: clearsGame ? null : state.gameId,
    members: leavesChampSelect
      ? state.members.map(({ champSelect: _cs, ...m }) => m)
      : state.members,
    observedAt: now,
  });
}

/** /lol-champ-select/v1/session — party cells only. */
export function reduceChampSelect(
  state: PartyState,
  session: unknown,
  now = Date.now()
): PartyState {
  if (session == null) return state;
  const cs = session as any;
  const myTeam: any[] = Array.isArray(cs?.myTeam) ? cs.myTeam : [];
  if (state.members.length === 0 || myTeam.length === 0) return state;

  const actions: any[] = Array.isArray(cs?.actions) ? cs.actions.flat() : [];
  const lockedCells = new Set<number>(
    actions
      .filter((a) => a?.type === "pick" && a?.completed)
      .map((a) => Number(a.actorCellId))
  );

  let changed = false;
  const members = state.members.map((m) => {
    const cell = myTeam.find(
      (c) =>
        (m.summonerId > 0 && Number(c?.summonerId) === m.summonerId) ||
        (m.puuid && typeof c?.puuid === "string" && c.puuid === m.puuid)
    );
    if (!cell) return m;
    const champSelect = {
      assignedRole: toRole(cell.assignedPosition),
      championLocked: lockedCells.has(Number(cell.cellId)),
    };
    if (
      m.champSelect?.assignedRole === champSelect.assignedRole &&
      m.champSelect?.championLocked === champSelect.championLocked
    ) {
      return m;
    }
    changed = true;
    return { ...m, champSelect };
  });

  if (!changed) return state;
  return withDerivedRoles({ ...state, members, observedAt: now });
}

/** Equality ignoring observedAt — decides whether to emit "party changed". */
export function samePartyState(a: PartyState, b: PartyState): boolean {
  const { observedAt: _a, ...ra } = a;
  const { observedAt: _b, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb);
}
