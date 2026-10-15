import {
  BadRequestException,
  ConflictException,
  HttpException,
} from "@nestjs/common";
import { SocketEvents } from "@lobly/shared-types";
import { JoinRequest, Listing } from "../../database/entities";
import { JoinProcessor } from "./join.processor";
import { JoinService } from "./join.service";

function codeOf(err: unknown): string {
  const body = (err as HttpException).getResponse() as { code?: string };
  return body?.code ?? "";
}

function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

function baseDeps() {
  const joins = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn(async (row: any) => row),
    create: jest.fn((row: any) => row),
  };
  const listings = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (row: any) => row),
  };
  const accounts = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const prefs = { findOne: jest.fn().mockResolvedValue(null) };
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
    setex: jest.fn(),
    exists: jest.fn().mockResolvedValue(1),
  };
  const dataSource = { transaction: jest.fn() };
  const profiles = {
    ensureFresh: jest.fn(),
    getSnapshotEntity: jest.fn(),
    getCard: jest.fn().mockResolvedValue({}),
  };
  const boardCache = { invalidate: jest.fn() };
  const listingsService = {
    toSummary: jest.fn((row: any) => ({ id: row.id, status: row.status })),
    emitListingClosed: jest.fn(),
  };
  const fanout = {
    emitToUser: jest.fn(),
    emitBoardUpsert: jest.fn(),
    emitListingState: jest.fn(),
    joinSessionRoom: jest.fn(),
  };
  const reputation = {
    assertUserCanListOrJoin: jest.fn(),
    isBlockedEitherWay: jest.fn().mockResolvedValue(false),
    getReliability: jest.fn().mockResolvedValue(90),
    recordEvent: jest.fn(),
  };
  const metrics = { log: jest.fn() };
  const sessions = {
    findActiveSummaryForUser: jest.fn().mockResolvedValue(null),
    detachOpenMember: jest.fn(),
    createOrAttach: jest.fn(),
    findActiveByJoin: jest.fn(),
  };
  const cleanup = {
    closePendingForRequester: jest.fn(),
    closePendingForListing: jest.fn(),
  };
  const service = new JoinService(
    joins as any,
    listings as any,
    accounts as any,
    prefs as any,
    queue as any,
    redis as any,
    dataSource as any,
    profiles as any,
    boardCache as any,
    listingsService as any,
    fanout as any,
    reputation as any,
    metrics as any,
    sessions as any,
    cleanup as any
  );
  return {
    service,
    joins,
    listings,
    accounts,
    queue,
    redis,
    dataSource,
    profiles,
    fanout,
    reputation,
    sessions,
    cleanup,
    listingsService,
  };
}

function acceptWorld() {
  const ctx = baseDeps();
  const listing: any = {
    id: "listing-1",
    status: "LISTED",
    expiresAt: new Date(Date.now() + 60_000),
    slots: [{ id: "s1", roles: [], open: true }],
    platform: "euw1",
    queueId: 420,
    creatorAccountId: "creator-acc",
    creatorAccount: {
      userId: "creator-user",
      riotId: "Host",
      tagLine: "EUW",
      summonerId: 7,
    },
  };
  const requests = new Map<string, any>();
  const people: Record<string, any> = {
    "req-a": {
      id: "req-a",
      userId: "user-a",
      summonerId: 11,
      riotId: "A",
      tagLine: "EUW",
    },
    "req-b": {
      id: "req-b",
      userId: "user-b",
      summonerId: 22,
      riotId: "B",
      tagLine: "EUW",
    },
  };
  function addRequest(id: string, accountId: string) {
    requests.set(id, {
      id,
      listingId: listing.id,
      requesterAccountId: accountId,
      roleSlot: null,
      status: "PENDING",
      decidedAt: null,
      inviteSentAt: null,
    });
  }
  addRequest("jr-1", "req-a");
  addRequest("jr-2", "req-b");

  ctx.listings.findOne.mockImplementation(async () => listing);
  ctx.joins.findOne.mockImplementation(async ({ where }: any) => {
    if (where?.id) return requests.get(where.id) ?? null;
    if (where?.status === "ACCEPTED") {
      for (const row of requests.values()) {
        if (row.status === "ACCEPTED" && row.listingId === where.listingId) {
          return row;
        }
      }
    }
    return null;
  });
  ctx.joins.save.mockImplementation(async (row: any) => {
    requests.set(row.id, row);
    return row;
  });
  ctx.accounts.findOne.mockImplementation(
    async ({ where }: any) => people[where.id] ?? null
  );
  ctx.redis.exists.mockResolvedValue(1);

  const manager = {
    findOne: jest.fn(async (entity: { name?: string }, opts: any) => {
      if (entity === Listing || entity?.name === "Listing") return listing;
      if (entity === JoinRequest || entity?.name === "JoinRequest") {
        return requests.get(opts.where.id) ?? null;
      }
      return null;
    }),
    save: jest.fn(async (row: any) => {
      if (row.requesterAccountId) requests.set(row.id, row);
      return row;
    }),
  };
  const run = createMutex();
  ctx.dataSource.transaction.mockImplementation((fn: any) =>
    run(() => fn(manager))
  );

  return { ...ctx, listing, requests, manager };
}

describe("JoinService.accept", () => {
  it("rejects a delisted listing with 400 and leaves the request pending", async () => {
    const { service, listing, requests, manager } = acceptWorld();
    listing.status = "DELISTED";
    await expect(service.accept("creator-user", "jr-1")).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(service.accept("creator-user", "jr-1")).rejects.toMatchObject({
      response: { code: "LISTING_NOT_OPEN" },
    });
    expect(requests.get("jr-1").status).toBe("PENDING");
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledWith(
      Listing,
      expect.objectContaining({ lock: { mode: "pessimistic_write" } })
    );
  });

  it("rejects an expired listing with 400 LISTING_NOT_OPEN", async () => {
    const { service, listing, requests } = acceptWorld();
    listing.expiresAt = new Date(Date.now() - 1000);
    try {
      await service.accept("creator-user", "jr-1");
      throw new Error("expected throw");
    } catch (err) {
      expect(codeOf(err)).toBe("LISTING_NOT_OPEN");
    }
    expect(requests.get("jr-1").status).toBe("PENDING");
  });

  it("rejects with 409 NO_SLOT and does not change the request", async () => {
    const { service, listing, requests, manager } = acceptWorld();
    listing.slots = [{ id: "s1", roles: [], open: false }];
    try {
      await service.accept("creator-user", "jr-1");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect(codeOf(err)).toBe("NO_SLOT");
      expect((err as ConflictException).getStatus()).toBe(409);
    }
    expect(requests.get("jr-1").status).toBe("PENDING");
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("lets exactly one of two parallel accepts take the only slot", async () => {
    const { service, requests, cleanup } = acceptWorld();
    const results = await Promise.allSettled([
      service.accept("creator-user", "jr-1"),
      service.accept("creator-user", "jr-2"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const denied = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(codeOf((denied[0] as PromiseRejectedResult).reason)).toBe("NO_SLOT");
    const statuses = [requests.get("jr-1").status, requests.get("jr-2").status].sort();
    expect(statuses).toEqual(["ACCEPTED", "PENDING"]);
    expect(cleanup.closePendingForRequester).toHaveBeenCalledTimes(1);
  });

  it("expires an offline requester with 409 and no reputation event", async () => {
    const { service, redis, requests, dataSource, reputation } = acceptWorld();
    redis.exists.mockResolvedValue(0);
    try {
      await service.accept("creator-user", "jr-1");
      throw new Error("expected throw");
    } catch (err) {
      expect(codeOf(err)).toBe("REQUESTER_OFFLINE");
      expect((err as ConflictException).getStatus()).toBe(409);
    }
    expect(requests.get("jr-1").status).toBe("EXPIRED");
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(reputation.recordEvent).not.toHaveBeenCalled();
    expect(redis.exists).toHaveBeenCalledWith("presence:user-a");
  });
});

describe("JoinService.requestJoin limits", () => {
  function ready(ctx: ReturnType<typeof baseDeps>) {
    ctx.listings.findOne.mockResolvedValue({
      id: "listing-1",
      status: "LISTED",
      creatorAccountId: "creator-acc",
      platform: "euw1",
      queueId: 420,
      type: "POSITIONAL",
      filters: {},
      slots: [{ id: "s1", roles: ["JUNGLE"], open: true }],
      voiceRequired: false,
      languages: [],
      queueMeta: {
        queueId: 420,
        gameMode: "CLASSIC",
        mapId: 11,
        maxLobbySize: 2,
        positional: true,
        isCustom: false,
        rankSource: "solo",
        duoRules: false,
      },
    });
    ctx.accounts.find.mockResolvedValue([
      {
        id: "req-acc",
        userId: "user-1",
        platform: "euw1",
        riotId: "Player",
        tagLine: "EUW",
      },
    ]);
    ctx.joins.findOne.mockResolvedValue(null);
    ctx.profiles.getSnapshotEntity.mockResolvedValue({
      soloTier: "GOLD",
      soloDivision: "II",
      flexTier: null,
      flexDivision: null,
      primaryRole: "JUNGLE",
      secondaryRole: "TOP",
      gamesThisSeason: 40,
    });
    ctx.joins.save.mockImplementation(async (row: any) => ({
      ...row,
      id: "jr-new",
      createdAt: new Date(),
    }));
  }

  it("enqueues a 10 minute pending-timeout job", async () => {
    const ctx = baseDeps();
    ready(ctx);
    await ctx.service.requestJoin("user-1", "listing-1", "JUNGLE");
    expect(ctx.queue.add).toHaveBeenCalledWith(
      "pending-timeout",
      { joinRequestId: "jr-new" },
      {
        delay: 10 * 60_000,
        jobId: "join-pending-jr-new",
        removeOnComplete: true,
      }
    );
  });

  it("rejects an existing ACCEPTED request with 409", async () => {
    const ctx = baseDeps();
    ready(ctx);
    ctx.joins.findOne.mockImplementation(async ({ where }: any) =>
      where?.status === "ACCEPTED" ? { id: "other", status: "ACCEPTED" } : null
    );
    await expect(
      ctx.service.requestJoin("user-1", "listing-1", "JUNGLE")
    ).rejects.toMatchObject({
      response: { code: "ALREADY_ACCEPTED_ELSEWHERE" },
      status: 409,
    });
  });

  it("rejects a fourth pending request with 429", async () => {
    const ctx = baseDeps();
    ready(ctx);
    ctx.joins.count.mockResolvedValue(3);
    await expect(
      ctx.service.requestJoin("user-1", "listing-1", "JUNGLE")
    ).rejects.toMatchObject({
      response: { code: "TOO_MANY_PENDING" },
      status: 429,
    });
  });

  it("rejects a member of an open session with 409", async () => {
    const ctx = baseDeps();
    ready(ctx);
    ctx.sessions.findActiveSummaryForUser.mockResolvedValue({ id: "s1" });
    await expect(
      ctx.service.requestJoin("user-1", "listing-1", "JUNGLE")
    ).rejects.toMatchObject({
      response: { code: "IN_SESSION" },
      status: 409,
    });
  });
});

describe("JoinService.cancel", () => {
  it("cancels a pending request and tells the creator, with no reputation event", async () => {
    const ctx = baseDeps();
    const jr = {
      id: "jr-1",
      listingId: "listing-1",
      requesterAccountId: "req-acc",
      status: "PENDING",
      decidedAt: null,
    };
    ctx.joins.findOne.mockResolvedValue(jr);
    ctx.accounts.findOne.mockResolvedValue({
      id: "req-acc",
      userId: "user-1",
    });
    ctx.listings.findOne.mockResolvedValue({
      id: "listing-1",
      creatorAccountId: "creator-acc",
      creatorAccount: { userId: "creator-user" },
      slots: [],
      platform: "euw1",
      queueId: 420,
    });
    await ctx.service.cancel("user-1", "jr-1");
    expect(jr.status).toBe("CANCELLED");
    expect(ctx.queue.remove).toHaveBeenCalledWith("join-pending-jr-1");
    expect(ctx.fanout.emitToUser).toHaveBeenCalledWith(
      "creator-user",
      SocketEvents.JOIN_CANCELLED,
      { joinRequestId: "jr-1" }
    );
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalled();
  });

  it("cancels an accepted request, reopens the slot, and records CANCELLED_AFTER_ACCEPT", async () => {
    const ctx = baseDeps();
    const jr = {
      id: "jr-1",
      listingId: "listing-1",
      requesterAccountId: "req-acc",
      status: "ACCEPTED",
      decidedAt: null,
    };
    const listing: any = {
      id: "listing-1",
      status: "FILLING",
      creatorAccountId: "creator-acc",
      creatorAccount: { userId: "creator-user" },
      slots: [{ id: "s1", roles: [], open: false, pendingAccountId: "req-acc" }],
      platform: "euw1",
      queueId: 420,
    };
    ctx.joins.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.id === "jr-1") return jr;
      if (where?.status === "ACCEPTED") return null;
      return null;
    });
    ctx.accounts.findOne.mockResolvedValue({ id: "req-acc", userId: "user-1" });
    ctx.listings.findOne.mockResolvedValue(listing);
    await ctx.service.cancel("user-1", "jr-1");
    expect(jr.status).toBe("CANCELLED");
    expect(listing.slots[0].open).toBe(true);
    expect(listing.slots[0].pendingAccountId).toBeNull();
    expect(ctx.fanout.emitToUser).toHaveBeenCalledWith(
      "creator-user",
      SocketEvents.JOIN_REOPENED,
      { listingId: "listing-1", joinRequestId: "jr-1" }
    );
    expect(ctx.reputation.recordEvent).toHaveBeenCalledWith(
      "req-acc",
      "CANCELLED_AFTER_ACCEPT",
      { joinRequestId: "jr-1" }
    );
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalledWith(
      "req-acc",
      "NO_SHOW",
      expect.anything()
    );
  });

  it("cancelOutgoingForUser uses cancel for pending and accepted rows", async () => {
    const ctx = baseDeps();
    ctx.accounts.find.mockResolvedValue([{ id: "req-acc", userId: "user-1" }]);
    ctx.joins.find.mockResolvedValue([
      { id: "p", status: "PENDING" },
      { id: "a", status: "ACCEPTED" },
    ]);
    const spy = jest.spyOn(ctx.service, "cancel").mockResolvedValue({ ok: true });
    await ctx.service.cancelOutgoingForUser("user-1");
    expect(spy).toHaveBeenCalledWith("user-1", "p");
    expect(spy).toHaveBeenCalledWith("user-1", "a");
  });
});

describe("JoinService invite timeout", () => {
  it("records inviteSentAt and restarts the 90s job", async () => {
    const ctx = baseDeps();
    const jr: any = {
      id: "jr-1",
      listingId: "listing-1",
      status: "ACCEPTED",
      inviteSentAt: null,
    };
    ctx.joins.findOne.mockResolvedValue(jr);
    ctx.listings.findOne.mockResolvedValue({
      id: "listing-1",
      creatorAccount: { userId: "creator-user" },
    });
    await ctx.service.inviteResult("creator-user", "jr-1", { ok: true });
    expect(jr.inviteSentAt).toBeInstanceOf(Date);
    expect(ctx.queue.remove).toHaveBeenCalledWith("join-timeout-jr-1");
    expect(ctx.queue.add).toHaveBeenCalledWith(
      "timeout",
      { joinRequestId: "jr-1" },
      expect.objectContaining({ delay: 90_000, jobId: "join-timeout-jr-1" })
    );
  });

  it("expires with INVITE_NOT_SENT and no reputation event when the invite was never sent", async () => {
    const ctx = baseDeps();
    const jr: any = {
      id: "jr-1",
      listingId: "listing-1",
      requesterAccountId: "req-acc",
      status: "ACCEPTED",
      inviteSentAt: null,
    };
    const listing: any = {
      id: "listing-1",
      status: "FILLING",
      creatorAccountId: "creator-acc",
      creatorAccount: { userId: "creator-user" },
      slots: [{ id: "s1", roles: [], open: false, pendingAccountId: "req-acc" }],
      platform: "euw1",
      queueId: 420,
    };
    ctx.joins.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.id === "jr-1") return jr;
      return null;
    });
    ctx.listings.findOne.mockResolvedValue(listing);
    ctx.accounts.findOne.mockResolvedValue({
      id: "req-acc",
      userId: "user-1",
    });
    await ctx.service.handleTimeout("jr-1");
    expect(jr.status).toBe("EXPIRED");
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalled();
    expect(ctx.fanout.emitToUser).toHaveBeenCalledWith(
      "user-1",
      SocketEvents.JOIN_FAILED,
      { joinRequestId: "jr-1", code: "INVITE_NOT_SENT" }
    );
  });

  it("records NO_SHOW when the invite was sent", async () => {
    const ctx = baseDeps();
    const jr: any = {
      id: "jr-1",
      listingId: "listing-1",
      requesterAccountId: "req-acc",
      status: "ACCEPTED",
      inviteSentAt: new Date(),
    };
    ctx.joins.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.id === "jr-1") return jr;
      return null;
    });
    ctx.listings.findOne.mockResolvedValue({
      id: "listing-1",
      status: "FILLING",
      creatorAccountId: "creator-acc",
      creatorAccount: { userId: "creator-user" },
      slots: [{ id: "s1", roles: [], open: false, pendingAccountId: "req-acc" }],
      platform: "euw1",
      queueId: 420,
    });
    ctx.accounts.findOne.mockResolvedValue({ id: "req-acc", userId: "user-1" });
    await ctx.service.handleTimeout("jr-1");
    expect(jr.status).toBe("NO_SHOW");
    expect(ctx.reputation.recordEvent).toHaveBeenCalledWith(
      "req-acc",
      "NO_SHOW",
      { joinRequestId: "jr-1" }
    );
  });

  it("expires a still-pending request on pending-timeout with no penalty", async () => {
    const ctx = baseDeps();
    const jr: any = {
      id: "jr-1",
      requesterAccountId: "req-acc",
      status: "PENDING",
    };
    ctx.joins.findOne.mockResolvedValue(jr);
    ctx.accounts.findOne.mockResolvedValue({ id: "req-acc", userId: "user-1" });
    await ctx.service.handlePendingTimeout("jr-1");
    expect(jr.status).toBe("EXPIRED");
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalled();
    expect(ctx.fanout.emitToUser).toHaveBeenCalledWith(
      "user-1",
      SocketEvents.JOIN_FAILED,
      { joinRequestId: "jr-1", code: "EXPIRED" }
    );
  });
});

describe("JoinService.memberLeft", () => {
  it("records ABANDONED only when the member leaves before queue", async () => {
    const ctx = baseDeps();
    ctx.sessions.detachOpenMember.mockResolvedValue({
      listingId: "listing-1",
      beforeQueue: true,
    });
    ctx.listings.findOne.mockResolvedValue({
      id: "listing-1",
      status: "READY",
      slots: [{ id: "s1", roles: [], open: false, pendingAccountId: "leaver" }],
      platform: "euw1",
      queueId: 420,
      creatorAccountId: "creator-acc",
    });
    ctx.joins.findOne.mockResolvedValue(null);
    await ctx.service.memberLeft("creator-user", "leaver");
    expect(ctx.reputation.recordEvent).toHaveBeenCalledWith("leaver", "ABANDONED");
  });

  it("does not penalize a leave after queue has started", async () => {
    const ctx = baseDeps();
    ctx.sessions.detachOpenMember.mockResolvedValue({
      listingId: "listing-1",
      beforeQueue: false,
    });
    await ctx.service.memberLeft("creator-user", "leaver");
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalled();
  });

  it("does nothing when the account is not in an open session", async () => {
    const ctx = baseDeps();
    ctx.sessions.detachOpenMember.mockResolvedValue(null);
    await ctx.service.memberLeft("creator-user", "stranger");
    expect(ctx.reputation.recordEvent).not.toHaveBeenCalled();
  });
});

describe("JoinProcessor", () => {
  it("routes pending-timeout and timeout jobs", async () => {
    const joins = {
      handleTimeout: jest.fn(),
      handlePendingTimeout: jest.fn(),
    };
    const processor = new JoinProcessor(joins as any);
    await processor.process({
      name: "pending-timeout",
      data: { joinRequestId: "jr-1" },
    } as any);
    await processor.process({
      name: "timeout",
      data: { joinRequestId: "jr-2" },
    } as any);
    expect(joins.handlePendingTimeout).toHaveBeenCalledWith("jr-1");
    expect(joins.handleTimeout).toHaveBeenCalledWith("jr-2");
  });
});
