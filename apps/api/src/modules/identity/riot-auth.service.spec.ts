import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import type Redis from "ioredis";
import { AuthService } from "./auth.service";
import { RiotAccountsService } from "./riot-accounts.service";
import { RiotAuthService, type RiotChallengePayload } from "./riot-auth.service";

const SUMMONER_BASE = {
  id: "sum",
  accountId: "acc",
  puuid: "puuid-1",
  revisionDate: 0,
  summonerLevel: 30,
};

function summoner(profileIconId: number) {
  return { ...SUMMONER_BASE, profileIconId };
}

function memoryRedis() {
  const kv = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, val: string) => {
      kv.set(key, val);
      return "OK";
    }),
    get: jest.fn(async (key: string) => kv.get(key) ?? null),
    del: jest.fn(async (key: string) => (kv.delete(key) ? 1 : 0)),
  };
  return { kv, redis };
}

/** Advances Date.now by the delay and resolves setTimeout immediately. */
function useInstantDelays() {
  let now = 1_700_000_000_000;
  const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  const timerSpy = jest.spyOn(global, "setTimeout").mockImplementation(((
    fn: TimerHandler,
    ms?: number
  ) => {
    now += typeof ms === "number" ? ms : 0;
    if (typeof fn === "function") fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout);
  return () => {
    dateSpy.mockRestore();
    timerSpy.mockRestore();
  };
}

describe("RiotAuthService", () => {
  const accountByRiotId = jest.fn();
  const summonerByPuuid = jest.fn();
  const regionForPlatform = jest.fn(() => "europe");
  const usersCreate = jest.fn((row) => row);
  const usersSave = jest.fn(async (row) => ({
    id: "user-new",
    banned: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...row,
  }));
  const usersFindOne = jest.fn();
  const accountsFindOne = jest.fn();
  const accountsCreate = jest.fn((row) => row);
  const accountsSave = jest.fn(async (row) => ({ id: "acc-new", ...row }));
  const issueTokens = jest.fn(async (user: { id: string; email: string | null; createdAt: Date }) => ({
    accessToken: "access",
    refreshToken: "refresh",
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    },
  }));
  const enqueueRefresh = jest.fn(async () => undefined);
  const joinAccountRooms = jest.fn(async () => undefined);

  let redis: ReturnType<typeof memoryRedis>["redis"];
  let service: RiotAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = memoryRedis().redis;
    accountByRiotId.mockResolvedValue({
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "EUW",
    });
    summonerByPuuid.mockResolvedValue(summoner(5));
    accountsFindOne.mockResolvedValue(null);
    service = new RiotAuthService(
      {
        create: usersCreate,
        save: usersSave,
        findOne: usersFindOne,
      } as never,
      {
        findOne: accountsFindOne,
        create: accountsCreate,
        save: accountsSave,
      } as never,
      {
        client: { accountByRiotId, summonerByPuuid, regionForPlatform },
      } as never,
      redis as unknown as Redis,
      { issueTokens } as unknown as AuthService,
      { enqueueRefresh } as never,
      { joinAccountRooms } as never
    );
  });

  async function challenge() {
    return service.createChallenge({
      gameName: "Player",
      tagLine: "EUW",
      platform: "EUW1",
    });
  }

  it("creates a challenge for a starter icon other than the current one", async () => {
    const created = await challenge();
    expect(created.iconId).toBeGreaterThanOrEqual(0);
    expect(created.iconId).toBeLessThanOrEqual(28);
    expect(created.iconId).not.toBe(5);
    expect(created.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    const exp = Date.parse(created.expiresAt);
    expect(exp).toBeGreaterThan(Date.now() + 590_000);
    expect(exp).toBeLessThan(Date.now() + 610_000);

    expect(redis.set).toHaveBeenCalledWith(
      `auth:riotchal:${created.challengeId}`,
      expect.any(String),
      "EX",
      600
    );
    const stored = JSON.parse(
      (redis.set as jest.Mock).mock.calls[0][1]
    ) as RiotChallengePayload;
    expect(stored).toMatchObject({
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "EUW",
      platform: "euw1",
      iconId: created.iconId,
      originalIconId: 5,
    });
    expect(regionForPlatform).toHaveBeenCalledWith("euw1");
  });

  it("verify creates a null-email user and issues tokens when the icon matches", async () => {
    const created = await challenge();
    summonerByPuuid.mockResolvedValue(summoner(created.iconId));

    const tokens = await service.verify({
      challengeId: created.challengeId,
      lcuPuuid: "lcu-1",
      summonerId: 42,
    });

    expect(usersCreate).toHaveBeenCalledWith({ email: null, passwordHash: null });
    expect(accountsSave).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-new",
        puuid: "puuid-1",
        lcuPuuid: "lcu-1",
        summonerId: "42",
        platform: "euw1",
      })
    );
    expect(enqueueRefresh).toHaveBeenCalledWith("acc-new", "interactive");
    expect(joinAccountRooms).toHaveBeenCalledWith("user-new");
    expect(issueTokens).toHaveBeenCalledWith(expect.objectContaining({ id: "user-new" }));
    expect(tokens.accessToken).toBe("access");
    expect(redis.get).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(`auth:riotchal:${created.challengeId}`);
  });

  it("verify signs in the existing riot account's user", async () => {
    const created = await challenge();
    summonerByPuuid.mockResolvedValue(summoner(created.iconId));
    accountsFindOne.mockResolvedValue({
      id: "acc-existing",
      userId: "user-existing",
      puuid: "puuid-1",
      lcuPuuid: null,
      summonerId: null,
    });
    usersFindOne.mockResolvedValue({
      id: "user-existing",
      email: null,
      passwordHash: null,
      banned: false,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const tokens = await service.verify({ challengeId: created.challengeId });

    expect(usersSave).not.toHaveBeenCalled();
    expect(usersCreate).not.toHaveBeenCalled();
    expect(issueTokens).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-existing" })
    );
    expect(tokens.user.id).toBe("user-existing");
    expect(joinAccountRooms).toHaveBeenCalledWith("user-existing");
    expect(enqueueRefresh).toHaveBeenCalledWith("acc-existing", "interactive");
  });

  it("verify times out when the icon never changes", async () => {
    const created = await challenge();
    const restore = useInstantDelays();
    try {
      await expect(service.verify({ challengeId: created.challengeId })).rejects.toMatchObject({
        response: { code: "ICON_NOT_CHANGED" },
      });
    } finally {
      restore();
    }
    expect(usersSave).not.toHaveBeenCalled();
    expect(issueTokens).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(summonerByPuuid.mock.calls.length).toBeGreaterThan(2);
  });

  it("verify rejects a different icon than the challenge target", async () => {
    const created = await challenge();
    expect(created.iconId).not.toBe(99);
    summonerByPuuid.mockResolvedValue(summoner(99));
    const restore = useInstantDelays();
    try {
      const err = await service
        .verify({ challengeId: created.challengeId })
        .then(() => null)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: "ICON_NOT_CHANGED",
      });
    } finally {
      restore();
    }
    expect(usersSave).not.toHaveBeenCalled();
    expect(issueTokens).not.toHaveBeenCalled();
  });
});

describe("AuthService.login", () => {
  it("rejects a Riot-only user without comparing a null password hash", async () => {
    const compare = jest.spyOn(require("bcrypt"), "compare");
    const users = {
      findOne: jest.fn(async () => ({
        id: "user-riot",
        email: null,
        passwordHash: null,
        banned: false,
        createdAt: new Date(),
      })),
    };
    const auth = new AuthService(
      users as never,
      {} as never,
      { getOrThrow: () => "secret" } as never,
      {} as never
    );

    await expect(auth.login("nobody@lobly.local", "password")).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
  });
});

describe("RiotAccountsService link and unlink", () => {
  const takeVerifiedChallenge = jest.fn();
  const enqueueRefresh = jest.fn(async () => undefined);
  const joinAccountRooms = jest.fn(async () => undefined);
  const delistActiveForAccount = jest.fn(async () => undefined);
  const cancelOutgoingForUser = jest.fn(async () => undefined);
  const accountsFindOne = jest.fn();
  const accountsCreate = jest.fn((row) => row);
  const accountsSave = jest.fn(async (row) => ({ id: "acc-linked", ...row }));
  const accountsDelete = jest.fn(async () => ({ affected: 1 }));
  const champDelete = jest.fn(async () => ({ affected: 1 }));
  const matchDelete = jest.fn(async () => ({ affected: 1 }));
  const snapDelete = jest.fn(async () => ({ affected: 1 }));

  function service() {
    return new RiotAccountsService(
      {
        findOne: accountsFindOne,
        create: accountsCreate,
        save: accountsSave,
        delete: accountsDelete,
        update: jest.fn(),
      } as never,
      { delete: snapDelete } as never,
      { delete: champDelete } as never,
      { delete: matchDelete } as never,
      { enqueueRefresh } as never,
      { takeVerifiedChallenge } as never,
      { delistActiveForAccount } as never,
      { cancelOutgoingForUser } as never,
      { joinAccountRooms } as never
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it("links the challenged account to the current user", async () => {
    const chal: RiotChallengePayload = {
      puuid: "real-puuid",
      gameName: "Real",
      tagLine: "EUW",
      platform: "euw1",
      iconId: 4,
      originalIconId: 1,
    };
    takeVerifiedChallenge.mockResolvedValue(chal);
    accountsFindOne.mockResolvedValue(null);

    const dto = await service().link("user-1", {
      challengeId: "11111111-1111-4111-8111-111111111111",
      lcuPuuid: "local",
      summonerId: 5,
    });

    expect(takeVerifiedChallenge).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(accountsSave).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        puuid: "real-puuid",
        riotId: "Real",
        tagLine: "EUW",
        lcuPuuid: "local",
        summonerId: "5",
      })
    );
    expect(joinAccountRooms).toHaveBeenCalledWith("user-1");
    expect(enqueueRefresh).toHaveBeenCalledWith("acc-linked", "interactive");
    expect(dto.puuid).toBe("real-puuid");
  });

  it("refuses to link a puuid owned by someone else", async () => {
    takeVerifiedChallenge.mockResolvedValue({
      puuid: "taken",
      gameName: "Other",
      tagLine: "EUW",
      platform: "euw1",
      iconId: 2,
      originalIconId: 1,
    });
    accountsFindOne.mockResolvedValue({ userId: "someone-else", puuid: "taken" });

    await expect(
      service().link("user-1", {
        challengeId: "11111111-1111-4111-8111-111111111111",
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(accountsSave).not.toHaveBeenCalled();
  });

  it("delists and cancels outgoing joins before deleting the account", async () => {
    const order: string[] = [];
    accountsFindOne.mockResolvedValue({ id: "acc-1", userId: "user-1" });
    delistActiveForAccount.mockImplementation(async () => {
      order.push("delist");
    });
    cancelOutgoingForUser.mockImplementation(async () => {
      order.push("cancel");
    });
    accountsDelete.mockImplementation(async () => {
      order.push("delete");
      return { affected: 1 };
    });

    await service().unlink("user-1", "acc-1");

    expect(delistActiveForAccount).toHaveBeenCalledWith("acc-1");
    expect(cancelOutgoingForUser).toHaveBeenCalledWith("user-1");
    expect(order).toEqual(["delist", "cancel", "delete"]);
  });
});
