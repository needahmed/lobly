import { SocketEvents } from "@lobly/shared-types";
import { SessionService } from "./session.service";
import { SessionSweeperService } from "./session-sweeper.service";

function setup() {
  const sessions = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (row: any) => row),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const messages = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const listings = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (row: any) => row),
  };
  const accounts = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const boardCache = { invalidate: jest.fn() };
  const fanout = {
    emitBoardRemove: jest.fn(),
    emitListingState: jest.fn(),
    emitToSession: jest.fn(),
    emitToUser: jest.fn(),
  };
  const reputation = {
    recordEvent: jest.fn(),
    isBlockedEitherWay: jest.fn().mockResolvedValue(false),
  };
  const metrics = { log: jest.fn() };
  const profiles = { ensureFresh: jest.fn() };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
    exists: jest.fn().mockResolvedValue(0),
  };
  const config = { get: jest.fn() };
  const joinCleanup = { closePendingForListing: jest.fn() };
  const service = new SessionService(
    sessions as any,
    messages as any,
    listings as any,
    accounts as any,
    {} as any,
    boardCache as any,
    {} as any,
    fanout as any,
    reputation as any,
    metrics as any,
    profiles as any,
    redis as any,
    config as any,
    joinCleanup as any
  );
  return {
    service,
    sessions,
    messages,
    listings,
    accounts,
    fanout,
    reputation,
    redis,
    joinCleanup,
  };
}

describe("SessionService.findActiveForUser via onSessionStart", () => {
  it("returns null when the user is not a member of the listing session", async () => {
    const ctx = setup();
    ctx.accounts.find.mockResolvedValue([{ id: "me", userId: "user-1" }]);
    ctx.sessions.findOne.mockResolvedValue({
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["someone-else"],
      endedAt: null,
      startedQueueAt: null,
    });
    const result = await ctx.service.onSessionStart("user-1", "l1");
    expect(result).toEqual({ ok: true });
    expect(ctx.listings.save).not.toHaveBeenCalled();
    expect(ctx.joinCleanup.closePendingForListing).not.toHaveBeenCalled();
  });

  it("starts the session and closes pending joins when the user is a member", async () => {
    const ctx = setup();
    const listing: any = {
      id: "l1",
      platform: "euw1",
      queueId: 420,
      creatorAccountId: "me",
      status: "READY",
    };
    ctx.accounts.find.mockResolvedValue([{ id: "me", userId: "user-1" }]);
    ctx.sessions.findOne.mockResolvedValue({
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["me", "them"],
      endedAt: null,
      startedQueueAt: null,
    });
    ctx.listings.findOne.mockResolvedValue(listing);
    const result = await ctx.service.onSessionStart("user-1", "l1");
    expect(result).toEqual({ ok: true, sessionId: "s1" });
    expect(listing.status).toBe("IN_SESSION");
    expect(ctx.joinCleanup.closePendingForListing).toHaveBeenCalledWith(
      "l1",
      "LOBBY_IN_GAME"
    );
  });
});

describe("SessionService.findActiveSummaryForUser", () => {
  it("returns the open session including endedAt and chatOpenUntil", async () => {
    const ctx = setup();
    ctx.accounts.find.mockResolvedValue([{ id: "me", userId: "user-1" }]);
    ctx.sessions.findOne.mockResolvedValue({
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["me"],
      leagueLobbyConfirmedAt: null,
      startedQueueAt: null,
      gamesPlayed: 0,
      endedAt: null,
      chatOpenUntil: null,
    });
    const summary = await ctx.service.findActiveSummaryForUser("user-1");
    expect(summary).toMatchObject({
      id: "s1",
      sessionId: "s1",
      listingId: "l1",
      memberAccountIds: ["me"],
      gamesPlayed: 0,
      endedAt: null,
      chatOpenUntil: null,
      chatOpen: true,
    });
  });
});

describe("SessionService history", () => {
  it("returns ChatMessagePayload rows with riot id and tag", async () => {
    const ctx = setup();
    ctx.sessions.findOne.mockResolvedValue({
      id: "s1",
      memberAccountIds: ["me"],
    });
    ctx.accounts.find.mockImplementation(async ({ where }: any) => {
      if (where?.userId) return [{ id: "me", userId: "user-1" }];
      return [
        { id: "me", riotId: "Me", tagLine: "EUW" },
        { id: "them", riotId: "Them", tagLine: "NA" },
      ];
    });
    const older = new Date("2026-10-15T10:00:00Z");
    const newer = new Date("2026-10-15T10:01:00Z");
    ctx.messages.find.mockResolvedValue([
      {
        id: "2",
        sessionId: "s1",
        fromAccountId: "them",
        body: "later",
        createdAt: newer,
      },
      {
        id: "1",
        sessionId: "s1",
        fromAccountId: "me",
        body: "earlier",
        createdAt: older,
      },
    ]);
    const rows = await ctx.service.history("user-1", "s1");
    expect(rows).toEqual([
      {
        id: 1,
        sessionId: "s1",
        from: { accountId: "me", riotId: "Me", tagLine: "EUW" },
        body: "earlier",
        at: older.toISOString(),
      },
      {
        id: 2,
        sessionId: "s1",
        from: { accountId: "them", riotId: "Them", tagLine: "NA" },
        body: "later",
        at: newer.toISOString(),
      },
    ]);
  });
});

describe("SessionService.onSessionEnd", () => {
  it("emits SESSION_ENDED with chatOpenUntil when the end is final", async () => {
    const ctx = setup();
    const session: any = {
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["me"],
      endedAt: null,
      chatOpenUntil: null,
      gamesPlayed: 0,
      startedQueueAt: new Date(),
    };
    ctx.accounts.find.mockResolvedValue([
      { id: "me", userId: "user-1", riotId: "Me", tagLine: "EUW" },
    ]);
    ctx.accounts.findOne.mockResolvedValue({
      id: "me",
      userId: "user-1",
      riotId: "Me",
      tagLine: "EUW",
    });
    ctx.sessions.findOne.mockResolvedValue(session);
    ctx.listings.findOne.mockResolvedValue({
      id: "l1",
      creatorAccountId: "me",
      status: "IN_SESSION",
    });
    await ctx.service.onSessionEnd("user-1", { listingId: "l1", final: true });
    expect(session.gamesPlayed).toBe(0);
    expect(ctx.fanout.emitToUser).not.toHaveBeenCalledWith(
      expect.anything(),
      SocketEvents.ENDORSE_PROMPT,
      expect.anything()
    );
    expect(session.endedAt).toBeInstanceOf(Date);
    expect(ctx.fanout.emitToSession).toHaveBeenCalledWith(
      "s1",
      SocketEvents.SESSION_ENDED,
      {
        sessionId: "s1",
        chatOpenUntil: session.chatOpenUntil.toISOString(),
      }
    );
  });
});

describe("SessionService.onGameEnded", () => {
  it("increments gamesPlayed once per game id", async () => {
    const ctx = setup();
    const session: any = {
      id: "s1",
      gamesPlayed: 0,
      riotVerifiedGameIds: [],
    };
    await ctx.service.onGameEnded(session, 42);
    expect(session.gamesPlayed).toBe(1);
    expect(session.riotVerifiedGameIds).toEqual(["42"]);
    await ctx.service.onGameEnded(session, 42);
    expect(session.gamesPlayed).toBe(1);
    await ctx.service.onGameEnded(session, 43);
    expect(session.gamesPlayed).toBe(2);
  });
});

describe("SessionService.detachOpenMember", () => {
  it("removes the account and reports beforeQueue from startedQueueAt", async () => {
    const ctx = setup();
    const session: any = {
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["creator", "leaver"],
      startedQueueAt: null,
      endedAt: null,
    };
    ctx.accounts.find.mockResolvedValue([{ id: "creator", userId: "user-1" }]);
    ctx.listings.find.mockResolvedValue([{ id: "l1", creatorAccountId: "creator" }]);
    ctx.sessions.findOne.mockResolvedValue(session);
    const result = await ctx.service.detachOpenMember("user-1", "leaver");
    expect(result).toEqual({ listingId: "l1", beforeQueue: true });
    expect(session.memberAccountIds).toEqual(["creator"]);
  });

  it("still removes the account after queue without marking beforeQueue", async () => {
    const ctx = setup();
    const session: any = {
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["creator", "leaver"],
      startedQueueAt: new Date(),
      endedAt: null,
    };
    ctx.accounts.find.mockResolvedValue([{ id: "creator" }]);
    ctx.listings.find.mockResolvedValue([{ id: "l1" }]);
    ctx.sessions.findOne.mockResolvedValue(session);
    const result = await ctx.service.detachOpenMember("user-1", "leaver");
    expect(result).toEqual({ listingId: "l1", beforeQueue: false });
    expect(session.memberAccountIds).toEqual(["creator"]);
  });

  it("does not touch a session the account is not in", async () => {
    const ctx = setup();
    ctx.accounts.find.mockResolvedValue([{ id: "creator" }]);
    ctx.listings.find.mockResolvedValue([{ id: "l1" }]);
    ctx.sessions.findOne.mockResolvedValue({
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["creator"],
      startedQueueAt: null,
    });
    const result = await ctx.service.detachOpenMember("user-1", "stranger");
    expect(result).toBeNull();
    expect(ctx.sessions.save).not.toHaveBeenCalled();
  });
});

describe("SessionService.sweepIdleSessions", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  function openSession(over: Partial<any> = {}) {
    return {
      id: "s1",
      listingId: "l1",
      memberAccountIds: ["a1"],
      createdAt: new Date(now.getTime() - 40 * 60 * 1000),
      startedQueueAt: null,
      leagueLobbyConfirmedAt: null,
      endedAt: null,
      chatOpenUntil: null,
      ...over,
    };
  }

  it("ends a session older than 6 hours even when someone is present", async () => {
    const ctx = setup();
    const session = openSession({
      createdAt: new Date(now.getTime() - 7 * 60 * 60 * 1000),
    });
    ctx.sessions.find.mockResolvedValue([session]);
    ctx.redis.exists.mockResolvedValue(1);
    const n = await ctx.service.sweepIdleSessions(now);
    expect(n).toBe(1);
    expect(session.endedAt).toEqual(now);
    expect(session.chatOpenUntil).toEqual(now);
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalled();
    expect(ctx.fanout.emitToUser).not.toHaveBeenCalled();
    expect(ctx.fanout.emitToSession).not.toHaveBeenCalled();
  });

  it("ends an idle session when nobody has a presence key", async () => {
    const ctx = setup();
    const session = openSession();
    ctx.sessions.find.mockResolvedValue([session]);
    ctx.accounts.find.mockResolvedValue([{ id: "a1", userId: "user-1" }]);
    ctx.redis.exists.mockResolvedValue(0);
    const n = await ctx.service.sweepIdleSessions(now);
    expect(n).toBe(1);
    expect(ctx.redis.exists).toHaveBeenCalledWith("presence:user-1");
  });

  it("keeps a session when a member is online", async () => {
    const ctx = setup();
    const session = openSession();
    ctx.sessions.find.mockResolvedValue([session]);
    ctx.accounts.find.mockResolvedValue([{ id: "a1", userId: "user-1" }]);
    ctx.redis.exists.mockResolvedValue(1);
    const n = await ctx.service.sweepIdleSessions(now);
    expect(n).toBe(0);
    expect(session.endedAt).toBeNull();
  });

  it("keeps a session with recent activity and no presence", async () => {
    const ctx = setup();
    const session = openSession({
      startedQueueAt: new Date(now.getTime() - 5 * 60 * 1000),
    });
    ctx.sessions.find.mockResolvedValue([session]);
    const n = await ctx.service.sweepIdleSessions(now);
    expect(n).toBe(0);
    expect(ctx.redis.exists).not.toHaveBeenCalled();
  });
});

describe("SessionSweeperService", () => {
  it("registers a repeatable job every 10 minutes", async () => {
    const queue = { add: jest.fn() };
    const sessions = { sweepIdleSessions: jest.fn() };
    const sweeper = new SessionSweeperService(queue as any, sessions as any);
    await sweeper.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(
      "sweep",
      {},
      {
        repeat: { every: 10 * 60 * 1000 },
        jobId: "session-idle-sweep",
        removeOnComplete: true,
      }
    );
  });
});
