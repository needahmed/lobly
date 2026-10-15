import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ListingStatus } from "@lobly/shared-types";
import { Listing } from "../../database/entities";
import { ListingsService } from "./listings.service";

function makeRow(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "listing-1",
    creatorAccountId: "acc-1",
    creatorAccount: { userId: "user-1" } as Listing["creatorAccount"],
    platform: "euw1",
    queueId: 420,
    type: "POSITIONAL",
    title: "Need jungle",
    description: null,
    status: ListingStatus.LISTED,
    filters: {},
    slots: [{ id: "s1", roles: ["JUNGLE"], open: true, pendingAccountId: null }],
    queueMeta: {
      queueId: 420,
      gameMode: "CLASSIC",
      mapId: 11,
      maxLobbySize: 5,
      positional: true,
      isCustom: false,
      rankSource: "solo",
      duoRules: true,
    },
    voiceRequired: false,
    languages: ["en"],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    pausedAt: null,
    delistedAt: null,
    pauseReason: null,
    ...overrides,
  } as Listing;
}

function build(row: Listing, opts?: { other?: boolean; save?: jest.Mock }) {
  const fanout = {
    emitBoardUpsert: jest.fn(async () => undefined),
    emitBoardRemove: jest.fn(async () => undefined),
    emitListingState: jest.fn(async () => undefined),
  };
  const accounts = {
    find: jest.fn(async () => [] as unknown[]),
    findOne: jest.fn(),
  };
  const events = { emit: jest.fn() };
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => [row]),
  };
  const listings = {
    findOne: jest.fn(async (q?: { where?: Record<string, unknown> }) => {
      const where = q?.where ?? {};
      if (where.creatorAccountId && where.id) {
        return opts?.other ? ({ id: "other-listing" } as Listing) : null;
      }
      if (where.id === row.id) return row;
      if (where.creatorAccountId === row.creatorAccountId) {
        return row.status === ListingStatus.DELISTED ? null : row;
      }
      return null;
    }),
    save: opts?.save ?? jest.fn(async (saved: Listing) => saved),
    createQueryBuilder: jest.fn(() => qb),
  };
  const svc = new ListingsService(
    listings as never,
    accounts as never,
    {} as never,
    {} as never,
    { invalidate: jest.fn(async () => undefined) } as never,
    {} as never,
    fanout as never,
    events as never
  );
  return { svc, fanout, events, listings, accounts };
}

async function expectConflict(run: () => Promise<unknown>, code: string) {
  try {
    await run();
    throw new Error(`expected ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code })
    );
  }
}

function partyBody(
  overrides: Partial<{
    queueId: number;
    filledRoles: ("JUNGLE" | "TOP" | "MIDDLE" | "BOTTOM" | "UTILITY")[];
    members: { puuid: string; summonerId: number; roles: ("JUNGLE" | "TOP")[]; isLeader: boolean }[];
  }> = {}
) {
  return {
    partyId: "party-1",
    queueId: overrides.queueId ?? 420,
    phase: "Lobby",
    filledRoles: overrides.filledRoles ?? [],
    members: overrides.members ?? [
      { puuid: "lcu-me", summonerId: 1, roles: ["MIDDLE" as const], isLeader: true },
    ],
  };
}

describe("reconcileParty", () => {
  it("closes a filled role and reopens only FILLED_IN_CLIENT", async () => {
    const row = makeRow({
      creatorAccount: { userId: "user-1", lcuPuuid: "lcu-me" } as Listing["creatorAccount"],
      slots: [
        { id: "jg", roles: ["JUNGLE"], open: true, pendingAccountId: null },
        { id: "top", roles: ["TOP"], open: true, pendingAccountId: null },
        { id: "owner", roles: ["MIDDLE"], open: false, closedReason: "OWNER" },
        { id: "filled", roles: ["BOTTOM"], open: false, closedReason: "FILLED" },
        { id: "client", roles: ["UTILITY"], open: false, closedReason: "FILLED_IN_CLIENT" },
        { id: "full", roles: ["TOP"], open: false, closedReason: "LOBBY_FULL" },
      ],
    });
    const { svc, accounts, fanout } = build(row);
    accounts.find.mockResolvedValue([
      { id: "acc-1", lcuPuuid: "lcu-me", riotId: "Me", tagLine: "EUW", summonerId: "1" },
    ]);

    await svc.reconcileParty("user-1", row.id, partyBody({ filledRoles: ["JUNGLE"] }));
    expect(row.slots.find((s) => s.id === "jg")).toMatchObject({
      open: false,
      closedReason: "FILLED_IN_CLIENT",
    });
    expect(row.slots.find((s) => s.id === "top")?.open).toBe(true);
    expect(row.slots.find((s) => s.id === "owner")).toMatchObject({
      open: false,
      closedReason: "OWNER",
    });
    expect(row.slots.find((s) => s.id === "filled")).toMatchObject({
      open: false,
      closedReason: "FILLED",
    });
    expect(row.slots.find((s) => s.id === "client")).toMatchObject({ open: true });
    expect(row.slots.find((s) => s.id === "full")).toMatchObject({
      open: false,
      closedReason: "LOBBY_FULL",
    });
    expect(row.party.members[0]).toMatchObject({ accountId: "acc-1", riotId: "Me#EUW" });

    await svc.reconcileParty("user-1", row.id, partyBody({ filledRoles: [] }));
    expect(row.slots.find((s) => s.id === "jg")).toMatchObject({ open: true });
    expect(row.slots.find((s) => s.id === "jg")?.closedReason).toBeUndefined();
    expect(row.slots.find((s) => s.id === "owner")?.closedReason).toBe("OWNER");
    expect(row.slots.find((s) => s.id === "filled")?.closedReason).toBe("FILLED");
    expect(row.slots.find((s) => s.id === "full")?.closedReason).toBe("LOBBY_FULL");
    expect(fanout.emitBoardUpsert).toHaveBeenCalled();
  });

  it("delists with QUEUE_CHANGED when the lobby queue drifts", async () => {
    const row = makeRow({
      creatorAccount: { userId: "user-1", lcuPuuid: "lcu-me" } as Listing["creatorAccount"],
    });
    const { svc, fanout } = build(row);
    const summary = await svc.reconcileParty(
      "user-1",
      row.id,
      partyBody({ queueId: 440 })
    );
    expect(summary.status).toBe(ListingStatus.DELISTED);
    expect(row.slots[0].open).toBe(true);
    expect(fanout.emitListingState).toHaveBeenCalledWith("acc-1", {
      listingId: row.id,
      status: ListingStatus.DELISTED,
      reason: "QUEUE_CHANGED",
    });
    expect(fanout.emitBoardRemove).toHaveBeenCalledWith("euw1", 420, row.id);
  });

  it("returns 403 when the caller's lcu puuid is not in the party", async () => {
    const row = makeRow({
      creatorAccount: { userId: "user-1", lcuPuuid: "lcu-me" } as Listing["creatorAccount"],
    });
    const { svc, listings } = build(row);
    try {
      await svc.reconcileParty(
        "user-1",
        row.id,
        partyBody({
          members: [{ puuid: "someone-else", summonerId: 9, roles: ["TOP"], isLeader: true }],
        })
      );
      throw new Error("expected 403");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getStatus()).toBe(403);
      expect((err as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ code: "NOT_IN_PARTY" })
      );
    }
    expect(listings.save).not.toHaveBeenCalled();
  });
});

describe("listing patch", () => {
  it("rejects a closed listing", async () => {
    const row = makeRow({ status: ListingStatus.DELISTED });
    const { svc, listings } = build(row);
    await expect(svc.patch("user-1", row.id, { title: "Still here" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    try {
      await svc.patch("user-1", row.id, { title: "Still here" });
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: "LISTING_CLOSED" })
      );
    }
    expect(listings.save).not.toHaveBeenCalled();
  });

  it("keeps pendingAccountId and forces that slot closed", async () => {
    const row = makeRow({
      status: ListingStatus.FILLING,
      slots: [
        { id: "s1", roles: ["JUNGLE"], open: false, pendingAccountId: "pending-acc" },
        { id: "s2", roles: [], open: true, pendingAccountId: null },
      ],
    });
    const { svc } = build(row);
    const summary = await svc.patch("user-1", row.id, {
      slots: [
        { id: "s1", roles: ["TOP"], open: true },
        { id: "s2", roles: [], open: true },
      ],
    });
    const reserved = summary.slots.find((s) => s.id === "s1");
    expect(reserved).toMatchObject({
      open: false,
      pendingAccountId: "pending-acc",
      roles: ["TOP"],
    });
  });

  it("rejects a patch that drops a slot with a pending join", async () => {
    const row = makeRow({
      slots: [
        { id: "s1", roles: ["JUNGLE"], open: false, pendingAccountId: "pending-acc" },
        { id: "s2", roles: [], open: true },
      ],
    });
    const { svc } = build(row);
    await expectConflict(
      () =>
        svc.patch("user-1", row.id, {
          slots: [{ id: "s2", roles: [], open: true }],
        }),
      "SLOT_HAS_PENDING_JOIN"
    );
  });

  it("emits a board upsert after a successful patch", async () => {
    const row = makeRow();
    const { svc, fanout } = build(row);
    await svc.patch("user-1", row.id, { title: "Updated title" });
    expect(fanout.emitBoardUpsert).toHaveBeenCalledTimes(1);
  });

  it("forces pendingAccountId null on create-style slot normalization", () => {
    const row = makeRow();
    const { svc } = build(row);
    const slots = (
      svc as unknown as {
        normalizeAndValidateSlots: (
          raw: unknown,
          meta: Listing["queueMeta"]
        ) => { pendingAccountId: string | null }[];
      }
    ).normalizeAndValidateSlots(
      [
        {
          id: "s1",
          roles: ["JUNGLE"],
          open: true,
          pendingAccountId: "client-supplied",
        },
      ],
      row.queueMeta
    );
    expect(slots[0].pendingAccountId).toBeNull();
  });
});

describe("applyStateInternal", () => {
  it("rejects pause from a delisted listing", async () => {
    const row = makeRow({ status: ListingStatus.DELISTED });
    const { svc } = build(row);
    await expectConflict(() => svc.applyStateInternal(row, "pause"), "INVALID_TRANSITION");
  });

  it("allows ready only from FILLING", async () => {
    const filling = makeRow({ status: ListingStatus.FILLING });
    const { svc } = build(filling);
    const summary = await svc.applyStateInternal(filling, "ready");
    expect(summary.status).toBe(ListingStatus.READY);

    const listed = makeRow();
    const listedSvc = build(listed).svc;
    await expectConflict(
      () => listedSvc.applyStateInternal(listed, "ready"),
      "INVALID_TRANSITION"
    );
  });

  it("reopens from READY back to LISTED", async () => {
    const row = makeRow({ status: ListingStatus.READY });
    const { svc } = build(row);
    const summary = await svc.applyStateInternal(row, "reopen");
    expect(summary.status).toBe(ListingStatus.LISTED);
  });

  it("resets a past expiry when relisting a paused listing", async () => {
    const row = makeRow({
      status: ListingStatus.PAUSED,
      expiresAt: new Date(Date.now() - 5_000),
    });
    const { svc } = build(row);
    await svc.applyStateInternal(row, "relist");
    expect(row.status).toBe(ListingStatus.LISTED);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
  });

  it("rejects relist of an expired delisted listing", async () => {
    const row = makeRow({
      status: ListingStatus.DELISTED,
      expiresAt: new Date(Date.now() - 5_000),
    });
    const { svc } = build(row);
    await expectConflict(() => svc.applyStateInternal(row, "relist"), "INVALID_TRANSITION");
  });

  it("relists a delisted listing that has not expired", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const row = makeRow({ status: ListingStatus.DELISTED, expiresAt });
    const { svc } = build(row);
    await svc.applyStateInternal(row, "relist");
    expect(row.status).toBe(ListingStatus.LISTED);
    expect(row.expiresAt).toBe(expiresAt);
  });

  it("rejects relist when another active listing exists", async () => {
    const row = makeRow({ status: ListingStatus.POST_SESSION });
    const { svc } = build(row, { other: true });
    await expectConflict(
      () => svc.applyStateInternal(row, "relist"),
      "ACTIVE_LISTING_EXISTS"
    );
  });

  it("maps a postgres unique violation to ACTIVE_LISTING_EXISTS", async () => {
    const row = makeRow({ status: ListingStatus.PAUSED });
    const save = jest.fn(async () => {
      const err = new Error("duplicate") as Error & { driverError: { code: string } };
      err.driverError = { code: "23505" };
      throw err;
    });
    const { svc } = build(row, { save });
    await expectConflict(() => svc.applyStateInternal(row, "relist"), "ACTIVE_LISTING_EXISTS");
  });

  it("emits listing.closed when delisted", async () => {
    const row = makeRow();
    const { svc, events } = build(row);
    await svc.applyStateInternal(row, "delist");
    expect(events.emit).toHaveBeenCalledWith("listing.closed", {
      listingId: row.id,
      code: "DELISTED",
    });
  });

  it("still pauses for an in-game phase", async () => {
    const row = makeRow({ status: ListingStatus.FILLING });
    const { svc } = build(row);
    const summary = await svc.applyStateInternal(row, "ready", "ChampSelect");
    expect(summary.status).toBe(ListingStatus.PAUSED);
  });
});

describe("expireDue", () => {
  it("emits listing.closed with LISTING_EXPIRED", async () => {
    const row = makeRow();
    const { svc, events } = build(row);
    await svc.expireDue();
    expect(row.status).toBe(ListingStatus.DELISTED);
    expect(events.emit).toHaveBeenCalledWith("listing.closed", {
      listingId: row.id,
      code: "LISTING_EXPIRED",
    });
  });
});

describe("delistActiveForAccount", () => {
  it("delists the account's active listing", async () => {
    const row = makeRow();
    const { svc, events } = build(row);
    await svc.delistActiveForAccount("acc-1");
    expect(row.status).toBe(ListingStatus.DELISTED);
    expect(events.emit).toHaveBeenCalledWith("listing.closed", {
      listingId: row.id,
      code: "DELISTED",
    });
  });
});
