import { Logger } from "@nestjs/common";
import { ProfileRefreshService } from "./profile-refresh.service";

describe("ProfileRefreshService", () => {
  const puuid = "puuid-1";

  function build() {
    const ids = Array.from({ length: 62 }, (_, i) => `EUW1_${String(i).padStart(3, "0")}`);
    const seen = ids.slice(0, 60);
    const unseen = ids.slice(60);
    const matchById = jest.fn(async (_region: string, matchId: string) => ({
      metadata: { matchId, participants: [puuid] },
      info: {
        gameId: 1,
        queueId: 420,
        gameCreation: 1_700_000_000_000,
        gameDuration: 1800,
        participants: [
          {
            puuid,
            championId: 1,
            win: true,
            kills: 2,
            deaths: 1,
            assists: 3,
            teamPosition: "MIDDLE",
          },
        ],
      },
    }));

    const matchesSeen = {
      find: jest.fn(async () => seen.map((matchId) => ({ matchId }))),
      create: jest.fn((row: unknown) => row),
      save: jest.fn(async () => undefined),
    };
    const matches = {
      find: jest.fn(async () =>
        seen.map((matchId) => ({
          matchId,
          queueId: 420,
          gameCreation: new Date(1_700_000_000_000),
          gameDuration: 1800,
          gameMode: "CLASSIC",
          gameVersion: "14.1",
          platform: "euw1",
          participants: [
            {
              puuid,
              championId: 1,
              win: true,
              kills: 1,
              deaths: 1,
              assists: 1,
              teamPosition: "MIDDLE",
            },
          ],
        }))
      ),
      upsert: jest.fn(async () => undefined),
    };
    const pass = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    };

    const svc = new ProfileRefreshService(
      { findOne: jest.fn(async () => ({ id: "acc", platform: "euw1", puuid })) } as never,
      pass as never,
      pass as never,
      matchesSeen as never,
      matches as never,
      { upsert: jest.fn(async () => undefined) } as never,
      {
        client: {
          regionForPlatform: () => "europe",
          leagueEntriesByPuuid: async () => [],
          summonerByPuuid: async () => ({ summonerLevel: 30, profileIconId: 1 }),
          matchIdsByPuuid: async () => ids,
          matchById,
        },
      } as never,
      { get: () => undefined } as never
    );

    return { svc, matchById, matches, unseen };
  }

  it("warns at boot when season env vars are unset", () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { svc } = build();
    svc.onModuleInit();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("SEASON_START_EPOCH")
    );
    warn.mockRestore();
  });

  it("throws a retryable error when the required match is not in the list yet", async () => {
    const { svc, matchById } = build();
    await expect(
      svc.refresh("acc", { mustIncludeMatchId: "EUW1_NOT_YET" })
    ).rejects.toThrow(/retryable: match EUW1_NOT_YET/);
    expect(matchById).not.toHaveBeenCalled();
  });

  it("loads seen matches from the database and calls Riot only for unseen ids", async () => {
    const { svc, matchById, matches, unseen } = build();
    await svc.refresh("acc");
    expect(matchById).toHaveBeenCalledTimes(2);
    expect(matchById.mock.calls.map((c) => c[1])).toEqual(unseen);
    expect(matches.find).toHaveBeenCalledTimes(1);
  });
});
