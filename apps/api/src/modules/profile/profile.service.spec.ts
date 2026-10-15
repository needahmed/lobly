import { ProfileService } from "./profile.service";

const account = {
  id: "owner-acc",
  userId: "owner",
  puuid: "p",
  riotId: "Owner",
  tagLine: "EUW",
  platform: "euw1",
  summonerId: null,
  verifiedAt: null,
  lastSeenAt: null,
};

const snap = {
  riotAccountId: "owner-acc",
  soloTier: "GOLD",
  soloDivision: "II",
  soloLp: 10,
  soloWins: 1,
  soloLosses: 1,
  flexTier: null,
  flexDivision: null,
  flexLp: null,
  flexWins: null,
  flexLosses: null,
  primaryRole: "MIDDLE",
  secondaryRole: null,
  formWr20: null,
  streak: 0,
  summonerLevel: 30,
  profileIconId: 1,
  gamesThisSeason: 10,
  refreshedAt: new Date(),
};

function prefs(discordReveal: "HIDDEN" | "ACCEPTED" | "PUBLIC") {
  return {
    userId: "owner",
    languages: ["en"],
    voice: "DISCORD" as const,
    vibeTags: [],
    discordTag: "owner#1234",
    discordReveal,
    autoAcceptLoblyInvites: true,
  };
}

function qb(exists: boolean) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    getExists: jest.fn(async () => exists),
  };
}

function build(reveal: "HIDDEN" | "ACCEPTED" | "PUBLIC", shared = false) {
  const sessions = { createQueryBuilder: jest.fn(() => qb(shared)) };
  const joinRequests = { createQueryBuilder: jest.fn(() => qb(false)) };
  const accounts = {
    findOne: jest.fn(async () => account),
    find: jest.fn(async ({ where }: { where: { userId: string } }) => {
      if (where.userId === "viewer") return [{ id: "viewer-acc" }];
      if (where.userId === "owner") return [{ id: "owner-acc" }];
      return [];
    }),
  };
  const svc = new ProfileService(
    accounts as never,
    { findOne: jest.fn(async () => snap) } as never,
    { find: jest.fn(async () => []) } as never,
    { findOne: jest.fn(async () => prefs(reveal)) } as never,
    sessions as never,
    joinRequests as never,
    { enqueueRefresh: jest.fn() } as never,
    { getChampionMap: jest.fn(async () => ({})) } as never
  );
  return { svc, sessions, joinRequests };
}

describe("ProfileService.getCard", () => {
  it("returns the discord tag and auto-accept flag to the owner", async () => {
    const { svc } = build("HIDDEN");
    const card = await svc.getCard("owner-acc", "owner");
    expect(card.prefs?.discordTag).toBe("owner#1234");
    expect(card.prefs?.autoAcceptLoblyInvites).toBe(true);
  });

  it("hides the tag and auto-accept from a stranger when reveal is hidden", async () => {
    const { svc, sessions } = build("HIDDEN");
    const card = await svc.getCard("owner-acc", "viewer");
    expect(card.prefs?.discordTag).toBeNull();
    expect(card.prefs?.autoAcceptLoblyInvites).toBe(false);
    expect(sessions.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("redacts owner-only fields when no viewer is passed", async () => {
    const { svc } = build("ACCEPTED");
    const card = await svc.getCard("owner-acc");
    expect(card.prefs?.discordTag).toBeNull();
    expect(card.prefs?.autoAcceptLoblyInvites).toBe(false);
  });

  it("shows a public tag but still hides auto-accept", async () => {
    const { svc } = build("PUBLIC");
    const card = await svc.getCard("owner-acc", "viewer");
    expect(card.prefs?.discordTag).toBe("owner#1234");
    expect(card.prefs?.autoAcceptLoblyInvites).toBe(false);
  });

  it("shows an ACCEPTED tag only when viewer and owner share a lobby", async () => {
    const hidden = build("ACCEPTED", false);
    const no = await hidden.svc.getCard("owner-acc", "viewer");
    expect(no.prefs?.discordTag).toBeNull();
    expect(no.prefs?.autoAcceptLoblyInvites).toBe(false);

    const shared = build("ACCEPTED", true);
    const yes = await shared.svc.getCard("owner-acc", "viewer");
    expect(yes.prefs?.discordTag).toBe("owner#1234");
    expect(yes.prefs?.autoAcceptLoblyInvites).toBe(false);
    expect(shared.sessions.createQueryBuilder).toHaveBeenCalled();
  });
});
