import { RiotHttpError } from "@lobly/riot-client";
import { SocketEvents } from "@lobly/shared-types";
import { GameLifecycleService, RetryablePostgameError } from "./game-lifecycle.service";

function build() {
  const reports = {
    findOne: jest.fn(),
    find: jest.fn(async () => [] as unknown[]),
    save: jest.fn(async (row: unknown) => row),
    create: jest.fn((row: unknown) => row),
  };
  const accounts = {
    find: jest.fn(async () => [] as unknown[]),
    findOne: jest.fn(),
  };
  const sessionRows = { find: jest.fn(async () => [] as unknown[]) };
  const sessions = { onGameEnded: jest.fn(async (row: unknown) => row) };
  const refresh = { refresh: jest.fn(async () => undefined) };
  const fanout = { emitToUser: jest.fn(async () => undefined) };
  const queue = { add: jest.fn(async () => undefined) };
  const redis = {
    set: jest.fn(async () => "OK"),
    del: jest.fn(async () => 1),
  };
  const matchById = jest.fn();
  const riot = {
    client: {
      matchById,
      regionForPlatform: () => "europe",
    },
  };
  const svc = new GameLifecycleService(
    reports as never,
    accounts as never,
    sessionRows as never,
    sessions as never,
    refresh as never,
    fanout as never,
    queue as never,
    redis as never,
    riot as never
  );
  return { svc, reports, accounts, sessionRows, sessions, refresh, fanout, queue, matchById };
}

const jobData = { platform: "euw1", gameId: 5, accountId: "acc", userId: "u1" };

function job(attemptsMade: number, attempts = 6) {
  return { data: jobData, attemptsMade, opts: { attempts } };
}

describe("postgame", () => {
  it("throws a retryable error on match-v5 404", async () => {
    const { svc, reports, accounts, matchById, refresh } = build();
    reports.findOne.mockResolvedValue({
      gameId: "5",
      platform: "euw1",
      riotAccountId: "acc",
      queueId: 420,
    });
    accounts.findOne.mockResolvedValue({ id: "acc", platform: "euw1", puuid: "real-me", userId: "u1" });
    matchById.mockRejectedValue(new RiotHttpError(404, "missing"));
    await expect(svc.processPostgame(job(0))).rejects.toBeInstanceOf(RetryablePostgameError);
    expect(refresh.refresh).not.toHaveBeenCalled();
    expect(matchById).toHaveBeenCalledWith("europe", "EUW1_5");
  });

  it("refreshes and verifies the party when the match is found", async () => {
    const { svc, reports, accounts, sessionRows, sessions, refresh, fanout, matchById } = build();
    const me = {
      id: "acc",
      userId: "u1",
      platform: "euw1",
      puuid: "real-me",
      riotId: "Me",
      tagLine: "EUW",
    };
    const mate = {
      id: "mate",
      userId: "u2",
      platform: "euw1",
      puuid: "real-mate",
      riotId: "Mate",
      tagLine: "EUW",
    };
    reports.findOne.mockResolvedValue({
      gameId: "5",
      platform: "euw1",
      riotAccountId: "acc",
      queueId: 440,
    });
    accounts.findOne.mockResolvedValue(me);
    accounts.find.mockResolvedValue([me, mate]);
    sessionRows.find.mockResolvedValue([
      {
        id: "s1",
        source: "LISTING",
        memberAccountIds: ["acc", "mate"],
        endedAt: null,
        riotVerifiedGameIds: [],
        gamesPlayed: 0,
      },
    ]);
    reports.find.mockResolvedValue([
      { riotAccountId: "acc", sessionId: null },
      { riotAccountId: "mate", sessionId: null },
    ]);
    matchById.mockResolvedValue({
      metadata: { matchId: "EUW1_5", participants: ["real-me", "real-mate"] },
      info: {
        gameId: 5,
        queueId: 440,
        gameCreation: 1,
        gameDuration: 1800,
        participants: [
          { puuid: "real-me", teamId: 100, teamPosition: "MIDDLE", win: true, championId: 1, kills: 1, deaths: 1, assists: 1 },
          { puuid: "real-mate", teamId: 100, teamPosition: "JUNGLE", win: true, championId: 2, kills: 1, deaths: 1, assists: 1 },
        ],
      },
    });

    await svc.processPostgame(job(0));

    expect(refresh.refresh).toHaveBeenCalledWith("acc", { mustIncludeMatchId: "EUW1_5" });
    expect(sessions.onGameEnded).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), 5);
    expect(fanout.emitToUser).toHaveBeenCalledWith(
      "u1",
      SocketEvents.POSTGAME_READY,
      expect.objectContaining({
        riotConfirmed: true,
        profileRefreshed: true,
        endorse: expect.objectContaining({
          sessionId: "s1",
          others: [expect.objectContaining({ accountId: "mate", role: "JUNGLE" })],
        }),
      })
    );
  });

  it("does not endorse when session members are not on the same team", async () => {
    const { svc, reports, accounts, sessionRows, sessions, fanout, matchById } = build();
    const me = { id: "acc", userId: "u1", platform: "euw1", puuid: "real-me", riotId: "Me", tagLine: "EUW" };
    const mate = { id: "mate", userId: "u2", platform: "euw1", puuid: "real-mate", riotId: "Mate", tagLine: "EUW" };
    reports.findOne.mockResolvedValue({ gameId: "5", platform: "euw1", riotAccountId: "acc" });
    accounts.findOne.mockResolvedValue(me);
    accounts.find.mockResolvedValue([me, mate]);
    sessionRows.find.mockResolvedValue([
      { id: "s1", source: "LISTING", memberAccountIds: ["acc", "mate"], riotVerifiedGameIds: [] },
    ]);
    reports.find.mockResolvedValue([
      { riotAccountId: "acc", sessionId: null },
      { riotAccountId: "mate", sessionId: null },
    ]);
    matchById.mockResolvedValue({
      metadata: { matchId: "EUW1_5", participants: [] },
      info: {
        gameId: 5,
        queueId: 420,
        gameCreation: 1,
        gameDuration: 100,
        participants: [
          { puuid: "real-me", teamId: 100, win: true, championId: 1, kills: 0, deaths: 0, assists: 0 },
          { puuid: "real-mate", teamId: 200, win: false, championId: 2, kills: 0, deaths: 0, assists: 0 },
        ],
      },
    });

    await svc.processPostgame(job(0));
    expect(sessions.onGameEnded).not.toHaveBeenCalled();
    expect(fanout.emitToUser).toHaveBeenCalledWith(
      "u1",
      SocketEvents.POSTGAME_READY,
      expect.objectContaining({ riotConfirmed: true, endorse: null })
    );
  });

  it("runs a plain refresh when the match never appears", async () => {
    const { svc, reports, accounts, matchById, refresh, fanout } = build();
    reports.findOne.mockResolvedValue({ gameId: "5", platform: "euw1", riotAccountId: "acc" });
    accounts.findOne.mockResolvedValue({ id: "acc", userId: "u1", platform: "euw1", puuid: "real-me" });
    matchById.mockRejectedValue(new RiotHttpError(404, "missing"));

    await expect(svc.processPostgame(job(5))).resolves.toBeUndefined();
    expect(refresh.refresh).toHaveBeenCalledWith("acc");
    expect(fanout.emitToUser).toHaveBeenCalledWith(
      "u1",
      SocketEvents.POSTGAME_READY,
      expect.objectContaining({ profileRefreshed: true, riotConfirmed: false, endorse: null })
    );
  });

  it("does not enqueue a postgame job for custom games", async () => {
    const { svc, accounts, reports, queue } = build();
    accounts.find.mockResolvedValue([
      { id: "acc", userId: "u1", platform: "euw1", lcuPuuid: "lcu", lastSeenAt: new Date() },
    ]);
    reports.findOne.mockResolvedValue(null);
    await svc.onGameEnded("u1", { gameId: 9, queueId: 0, memberPuuids: ["lcu"] });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
