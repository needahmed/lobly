import { BoardService } from "./board.service";

describe("BoardService.browse myRequest", () => {
  it("attaches the viewer's pending or accepted request in one query", async () => {
    const now = new Date();
    const queueMeta = {
      queueId: 450,
      gameMode: "ARAM",
      mapId: 12,
      maxLobbySize: 5,
      positional: false,
      isCustom: false,
      rankSource: null,
      duoRules: false,
    };
    const viewer = {
      id: "viewer-acc",
      userId: "user-1",
      platform: "euw1",
      riotId: "Viewer",
      tagLine: "EUW",
    };
    const creator = {
      id: "creator-acc",
      userId: "creator-user",
      platform: "euw1",
      riotId: "Creator",
      tagLine: "EUW",
    };
    const snap = {
      riotAccountId: viewer.id,
      soloTier: "GOLD",
      soloDivision: "II",
      flexTier: null,
      flexDivision: null,
      primaryRole: "MIDDLE",
      secondaryRole: null,
      gamesThisSeason: 20,
    };
    const creatorSnap = { ...snap, riotAccountId: creator.id };
    const listing = (id: string) => ({
      id,
      creatorAccountId: creator.id,
      platform: "euw1",
      queueId: 450,
      type: "OPEN",
      title: id,
      description: null,
      status: "LISTED",
      filters: {},
      slots: [{ id: "s1", roles: [], open: true }],
      voiceRequired: false,
      languages: ["en"],
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      queueMeta,
    });

    const joinRequests = {
      find: jest.fn(async () => [
        {
          id: "jr-1",
          listingId: "l1",
          status: "PENDING",
          requesterAccountId: viewer.id,
          createdAt: now,
        },
      ]),
    };
    const accounts = {
      findOne: jest.fn(async () => viewer),
      find: jest.fn(async (q: { where?: { userId?: string } }) => {
        if (q.where?.userId) return [viewer];
        return [creator];
      }),
    };
    const snapshots = {
      findOne: jest.fn(async () => snap),
      find: jest.fn(async () => [creatorSnap]),
    };

    const svc = new BoardService(
      { find: jest.fn(async () => [listing("l1"), listing("l2")]) } as never,
      joinRequests as never,
      accounts as never,
      snapshots as never,
      { findOne: jest.fn(async () => null) } as never,
      { find: jest.fn(async () => []) } as never,
      { ensureFresh: jest.fn(async () => snap) } as never,
      { getChampionMap: jest.fn(async () => ({})) } as never,
      { getCandidateIds: jest.fn(async () => ["l1", "l2"]) } as never,
      {
        mine: jest.fn(async () => null),
        toSummary: (row: { id: string; expiresAt: Date; createdAt: Date }) => ({
          ...row,
          expiresAt: row.expiresAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        }),
      } as never
    );

    const rows = await svc.browse("user-1", { riotAccountId: viewer.id });
    expect(joinRequests.find).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.listing.id === "l1")?.myRequest).toEqual({
      id: "jr-1",
      status: "PENDING",
    });
    expect(rows.find((r) => r.listing.id === "l2")?.myRequest).toBeNull();
  });
});
