/**
 * LCU payload fixtures shaped after /lol-lobby/v2/lobby,
 * /lol-gameflow/v1/session and /lol-champ-select/v1/session. Hand-built from
 * the documented field names, trimmed to what the reducers read — replace
 * with real captures from tools/lcu-standalone/wsdump.mjs when available.
 */

export const LOCAL = { puuid: "local-uuid-1", summonerId: 1001 };
export const FRIEND = { puuid: "friend-uuid-2", summonerId: 1002 };

export function lobby(overrides: Record<string, unknown> = {}) {
  return {
    partyId: "party-abc",
    gameConfig: {
      queueId: 440,
      gameMode: "CLASSIC",
      mapId: 11,
      maxLobbySize: 5,
      showPositionSelector: true,
      isCustom: false,
    },
    localMember: { puuid: LOCAL.puuid, summonerId: LOCAL.summonerId },
    members: [
      {
        puuid: LOCAL.puuid,
        summonerId: LOCAL.summonerId,
        gameName: "NeedAhmed",
        tagLine: "main",
        isLeader: true,
        firstPositionPreference: "MIDDLE",
        secondPositionPreference: "TOP",
        ready: true,
      },
      {
        puuid: FRIEND.puuid,
        summonerId: FRIEND.summonerId,
        gameName: "Friend",
        tagLine: "EUW",
        isLeader: false,
        firstPositionPreference: "UTILITY",
        secondPositionPreference: "FILL",
        ready: true,
      },
    ],
    ...overrides,
  };
}

export function gameflowSession(
  phase: string,
  opts: { queueId?: number; gameId?: number; gameMode?: string } = {}
) {
  return {
    phase,
    gameData: {
      gameId: opts.gameId ?? 0,
      queue: {
        id: opts.queueId ?? 440,
        type: "RANKED_FLEX_SR",
        gameMode: opts.gameMode ?? "CLASSIC",
      },
      teamOne: [],
      teamTwo: [],
      playerChampionSelections: [],
    },
  };
}

/** Ranked-style champ select: the two party members plus three strangers. */
export function champSelect(opts: { friendLocked?: boolean } = {}) {
  return {
    timer: { phase: "BAN_PICK" },
    myTeam: [
      { cellId: 0, summonerId: LOCAL.summonerId, puuid: LOCAL.puuid, assignedPosition: "middle" },
      { cellId: 1, summonerId: FRIEND.summonerId, puuid: FRIEND.puuid, assignedPosition: "utility" },
      { cellId: 2, summonerId: 0, puuid: "", assignedPosition: "top" },
      { cellId: 3, summonerId: 0, puuid: "", assignedPosition: "jungle" },
      { cellId: 4, summonerId: 5555, puuid: "stranger-uuid", assignedPosition: "bottom" },
    ],
    theirTeam: [],
    actions: [
      [
        { actorCellId: 1, championId: 412, completed: !!opts.friendLocked, type: "pick", isAllyAction: true },
        { actorCellId: 4, championId: 22, completed: true, type: "pick", isAllyAction: true },
      ],
    ],
  };
}
