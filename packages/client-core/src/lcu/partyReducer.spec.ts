import { isLegalTransition } from "@lobly/shared-types";
import {
  emptyParty,
  reduceChampSelect,
  reduceGameflowSession,
  reduceLobby,
  reducePhase,
  toRole,
} from "./partyReducer";
import { FRIEND, LOCAL, champSelect, gameflowSession, lobby } from "./__fixtures__/lcu";

const NOW = 1_700_000_000_000;

function applied(r: ReturnType<typeof reduceGameflowSession>) {
  if (r.kind !== "applied") throw new Error(`expected applied, got ${r.kind}`);
  return r.state;
}

describe("toRole", () => {
  it("maps LCU positions in either case and drops fill/unselected", () => {
    expect(toRole("MIDDLE")).toBe("MIDDLE");
    expect(toRole("utility")).toBe("UTILITY");
    expect(toRole("bottom")).toBe("BOTTOM");
    expect(toRole("FILL")).toBeNull();
    expect(toRole("UNSELECTED")).toBeNull();
    expect(toRole("")).toBeNull();
    expect(toRole(undefined)).toBeNull();
  });
});

describe("reduceLobby", () => {
  it("builds the party roster, local flag and open roles", () => {
    const s = reduceLobby(emptyParty(), lobby(), NOW);
    expect(s.partyId).toBe("party-abc");
    expect(s.queueId).toBe(440);
    expect(s.positional).toBe(true);
    expect(s.maxLobbySize).toBe(5);
    expect(s.members).toHaveLength(2);
    expect(s.members[0]).toMatchObject({
      riotId: "NeedAhmed#main",
      isLocal: true,
      isLeader: true,
      roles: ["MIDDLE", "TOP"],
    });
    expect(s.members[1]).toMatchObject({ isLocal: false, roles: ["UTILITY"] });
    expect(s.filledRoles).toEqual(["MIDDLE", "UTILITY"]);
    expect(s.openRoles).toEqual(["TOP", "JUNGLE", "BOTTOM"]);
  });

  it("reports no role split for non-positional queues", () => {
    const aram = lobby({
      gameConfig: { queueId: 450, gameMode: "ARAM", maxLobbySize: 5, showPositionSelector: false },
    });
    const s = reduceLobby(emptyParty(), aram, NOW);
    expect(s.positional).toBe(false);
    expect(s.filledRoles).toEqual([]);
    expect(s.openRoles).toEqual([]);
  });

  it("clears the party when the lobby closes while idle", () => {
    const inLobby = reducePhase(reduceLobby(emptyParty(), lobby(), NOW), "Lobby", NOW);
    const s = reduceLobby(inLobby, null, NOW);
    expect(s.members).toEqual([]);
    expect(s.partyId).toBeNull();
  });

  it("keeps the party when the lobby resource disappears mid-game", () => {
    const inGame = reducePhase(reduceLobby(emptyParty(), lobby(), NOW), "InProgress", NOW);
    expect(reduceLobby(inGame, null, NOW)).toBe(inGame);
  });

  it("ignores payloads that are not lobby objects", () => {
    const s = reduceLobby(emptyParty(), lobby(), NOW);
    expect(reduceLobby(s, [{ summonerId: 1 }], NOW)).toBe(s);
  });
});

describe("reduceGameflowSession", () => {
  it("sets phase, queue and captures gameId once the game exists", () => {
    let s = applied(reduceGameflowSession(emptyParty(), gameflowSession("Lobby"), NOW));
    expect(s.phase).toBe("Lobby");
    expect(s.gameId).toBeNull();
    s = applied(reduceGameflowSession(s, gameflowSession("InProgress", { gameId: 7012345678 }), NOW));
    expect(s.phase).toBe("InProgress");
    expect(s.gameId).toBe(7012345678);
  });

  it("keeps gameId through end of game and drops it back in the lobby", () => {
    let s = applied(
      reduceGameflowSession(emptyParty(), gameflowSession("InProgress", { gameId: 42 }), NOW)
    );
    s = applied(reduceGameflowSession(s, gameflowSession("WaitingForStats", { gameId: 42 }), NOW));
    s = applied(reduceGameflowSession(s, gameflowSession("EndOfGame", { gameId: 42 }), NOW));
    expect(s.gameId).toBe(42);
    s = applied(reduceGameflowSession(s, gameflowSession("Lobby"), NOW));
    expect(s.gameId).toBeNull();
  });

  it("drops a late session from the previous queue while a game is locked in", () => {
    const s = applied(
      reduceGameflowSession(emptyParty(), gameflowSession("ChampSelect", { queueId: 420 }), NOW)
    );
    const r = reduceGameflowSession(s, gameflowSession("ChampSelect", { queueId: 440 }), NOW);
    expect(r.kind).toBe("stale");
  });

  it("accepts a queue change while still in the lobby", () => {
    const s = applied(reduceGameflowSession(emptyParty(), gameflowSession("Lobby", { queueId: 420 }), NOW));
    const next = applied(reduceGameflowSession(s, gameflowSession("Lobby", { queueId: 440 }), NOW));
    expect(next.queueId).toBe(440);
  });

  it("treats a missing session as idle and rejects garbage", () => {
    const s = applied(reduceGameflowSession(emptyParty(), gameflowSession("Lobby"), NOW));
    expect(applied(reduceGameflowSession(s, null, NOW)).phase).toBe("None");
    expect(reduceGameflowSession(s, { phase: "Bogus" }, NOW).kind).toBe("invalid");
  });
});

describe("reduceChampSelect", () => {
  function partyInChampSelect() {
    return reducePhase(reduceLobby(emptyParty(), lobby(), NOW), "ChampSelect", NOW);
  }

  it("records assigned roles and locks for party members only", () => {
    const s = reduceChampSelect(partyInChampSelect(), champSelect({ friendLocked: true }), NOW);
    const local = s.members.find((m) => m.summonerId === LOCAL.summonerId)!;
    const friend = s.members.find((m) => m.summonerId === FRIEND.summonerId)!;
    expect(local.champSelect).toEqual({ assignedRole: "MIDDLE", championLocked: false });
    expect(friend.champSelect).toEqual({ assignedRole: "UTILITY", championLocked: true });
  });

  it("never adds champ-select strangers to the party", () => {
    const s = reduceChampSelect(partyInChampSelect(), champSelect(), NOW);
    expect(s.members).toHaveLength(2);
    expect(JSON.stringify(s)).not.toContain("stranger-uuid");
    expect(JSON.stringify(s)).not.toContain("5555");
  });

  it("assigned positions override lobby preferences for filled roles", () => {
    const base = partyInChampSelect();
    const withPrefs = reduceLobby(
      base,
      lobby({
        members: (lobby().members as any[]).map((m) => ({ ...m, firstPositionPreference: "TOP" })),
      }),
      NOW
    );
    const s = reduceChampSelect(withPrefs, champSelect(), NOW);
    expect(s.filledRoles).toEqual(["MIDDLE", "UTILITY"]);
  });

  it("drops champ-select data once the client is back in the lobby", () => {
    const cs = reduceChampSelect(partyInChampSelect(), champSelect(), NOW);
    const back = reducePhase(cs, "Lobby", NOW);
    expect(back.members.every((m) => m.champSelect === undefined)).toBe(true);
  });
});

describe("isLegalTransition", () => {
  it("accepts the normal game loop", () => {
    const loop = [
      "Lobby",
      "Matchmaking",
      "ReadyCheck",
      "ChampSelect",
      "GameStart",
      "InProgress",
      "WaitingForStats",
      "PreEndOfGame",
      "EndOfGame",
      "Lobby",
    ] as const;
    for (let i = 1; i < loop.length; i++) {
      expect(isLegalTransition(loop[i - 1], loop[i])).toBe(true);
    }
  });

  it("accepts cold start, reconnect and remake paths", () => {
    expect(isLegalTransition(null, "InProgress")).toBe(true);
    expect(isLegalTransition("InProgress", "TerminatedInError")).toBe(true);
    expect(isLegalTransition("TerminatedInError", "Reconnect")).toBe(true);
    expect(isLegalTransition("Reconnect", "InProgress")).toBe(true);
  });

  it("rejects self-transitions and out-of-order echoes", () => {
    expect(isLegalTransition("Lobby", "Lobby")).toBe(false);
    expect(isLegalTransition("EndOfGame", "InProgress")).toBe(false);
    expect(isLegalTransition("Lobby", "InProgress")).toBe(false);
    expect(isLegalTransition("WaitingForStats", "ChampSelect")).toBe(false);
  });
});
