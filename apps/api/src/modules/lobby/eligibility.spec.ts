import { evaluateEligibility } from "./eligibility";
import { duoLegal, duoLegalRange } from "./duo-legality";
import { rankToInt } from "../profile/rank-math";
import { matchScore } from "./match-score";
import type { UserPrefs } from "@lobly/shared-types";

const prefs: UserPrefs = {
  languages: ["en"],
  voice: "DISCORD",
  vibeTags: [],
  discordTag: null,
  discordReveal: "HIDDEN",
  autoAcceptLoblyInvites: false,
};

const baseListing = {
  platform: "euw1",
  queueId: 420 as const,
  type: "POSITIONAL" as const,
  filters: {
    minTier: "GOLD",
    minDivision: "IV",
    maxTier: "PLATINUM",
    maxDivision: "I",
  },
  slots: [{ id: "s1", roles: ["JUNGLE" as const], open: true }],
  voiceRequired: false,
  languages: ["en"],
  queueMeta: {
    queueId: 420,
    gameMode: "CLASSIC",
    mapId: 11,
    maxLobbySize: 2,
    positional: true,
    isCustom: false,
    rankSource: "solo" as const,
    duoRules: true,
  },
};

const goldJungler = {
  platform: "euw1",
  soloTier: "GOLD",
  soloDivision: "II",
  flexTier: null,
  flexDivision: null,
  primaryRole: "JUNGLE" as const,
  secondaryRole: "TOP" as const,
  gamesThisSeason: 40,
};

const creatorGold = { soloTier: "GOLD", soloDivision: "I" };

describe("rankToInt", () => {
  it("orders tiers and divisions", () => {
    expect(rankToInt("IRON", "IV")).toBeLessThan(rankToInt("BRONZE", "IV")!);
    expect(rankToInt("GOLD", "IV")).toBeLessThan(rankToInt("GOLD", "I")!);
    expect(rankToInt("MASTER", "I")).toBe(rankToInt("MASTER", "IV"));
  });
});

describe("duoLegal", () => {
  it("allows ±1 tier in IRON..EMERALD", () => {
    expect(duoLegal("GOLD", "II", "PLATINUM", "IV")).toBe(true);
    expect(duoLegal("GOLD", "II", "EMERALD", "IV")).toBe(false);
  });

  it("diamond within 2 divisions", () => {
    expect(duoLegal("DIAMOND", "IV", "DIAMOND", "II")).toBe(true);
    expect(duoLegal("DIAMOND", "IV", "DIAMOND", "I")).toBe(false);
  });

  it("blocks Master+", () => {
    expect(duoLegal("MASTER", null, "DIAMOND", "I")).toBe(false);
    expect(duoLegal("GOLD", "I", "GRANDMASTER", null)).toBe(false);
  });

  it("Emerald/Diamond boundary", () => {
    expect(duoLegal("EMERALD", "I", "DIAMOND", "IV")).toBe(true);
    expect(duoLegal("EMERALD", "IV", "DIAMOND", "I")).toBe(false);
  });
});

describe("duoLegalRange", () => {
  it("returns ±1 tier window for gold", () => {
    const r = duoLegalRange("GOLD", "II");
    expect(r).not.toBeNull();
    expect(r!.minInt).toBe(rankToInt("SILVER", "IV"));
    expect(r!.maxInt).toBe(rankToInt("PLATINUM", "I"));
  });

  it("returns null for Master+", () => {
    expect(duoLegalRange("MASTER", null)).toBeNull();
  });
});

describe("evaluateEligibility", () => {
  it("passes a matching jungler", () => {
    const r = evaluateEligibility(baseListing, goldJungler, prefs, creatorGold);
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.offRole).toBe(false);
  });

  it("matches role-set secondary", () => {
    const listing = {
      ...baseListing,
      slots: [{ id: "s1", roles: ["MIDDLE" as const, "JUNGLE" as const], open: true }],
    };
    const r = evaluateEligibility(listing, goldJungler, prefs, creatorGold);
    expect(r.eligible).toBe(true);
  });

  it("any-role slot accepts anyone", () => {
    const listing = {
      ...baseListing,
      slots: [{ id: "s1", roles: [], open: true }],
    };
    const r = evaluateEligibility(
      listing,
      { ...goldJungler, primaryRole: "BOTTOM", secondaryRole: null },
      prefs,
      creatorGold
    );
    expect(r.eligible).toBe(true);
    expect(r.offRole).toBe(false);
  });

  it("collects all failing reasons", () => {
    const r = evaluateEligibility(
      {
        ...baseListing,
        platform: "na1",
        voiceRequired: true,
        languages: ["de"],
        filters: { ...baseListing.filters, minGames: 100 },
      },
      {
        ...goldJungler,
        platform: "euw1",
        soloTier: "IRON",
        soloDivision: "IV",
        gamesThisSeason: 2,
        primaryRole: "BOTTOM",
        secondaryRole: null,
      },
      { ...prefs, voice: "NO_VOICE", languages: ["en"] },
      creatorGold,
      "JUNGLE"
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        "PLATFORM_MISMATCH",
        "RANK_TOO_LOW",
        "DUO_ILLEGAL",
        "LANGUAGE_MISMATCH",
        "VOICE_REQUIRED",
        "GAMES_FLOOR",
      ])
    );
    expect(r.offRole).toBe(true);
  });

  it("ARAM with rank filter enforces it", () => {
    const r = evaluateEligibility(
      {
        ...baseListing,
        queueId: 450,
        type: "OPEN",
        filters: { minTier: "DIAMOND", minDivision: "I" },
        slots: [{ id: "s1", roles: [], open: true }],
        queueMeta: {
          queueId: 450,
          gameMode: "ARAM",
          mapId: 12,
          maxLobbySize: 5,
          positional: false,
          isCustom: false,
          rankSource: null,
          duoRules: false,
        },
      },
      { ...goldJungler, primaryRole: "MIDDLE" },
      prefs,
      creatorGold
    );
    expect(r.reasons).toContain("RANK_TOO_LOW");
  });

  it("ARAM without rank filter allows anyone", () => {
    const r = evaluateEligibility(
      {
        ...baseListing,
        queueId: 450,
        type: "OPEN",
        filters: {},
        slots: [{ id: "s1", roles: [], open: true }],
        queueMeta: {
          queueId: 450,
          gameMode: "ARAM",
          mapId: 12,
          maxLobbySize: 5,
          positional: false,
          isCustom: false,
          rankSource: null,
          duoRules: false,
        },
      },
      { ...goldJungler, soloTier: null, soloDivision: null },
      prefs,
      creatorGold
    );
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain("RANK_UNKNOWN");
  });

  it("unranked passes when no rank bound is set (non-duo queue)", () => {
    const r = evaluateEligibility(
      {
        ...baseListing,
        queueId: 440,
        type: "POSITIONAL",
        filters: {},
        queueMeta: {
          ...baseListing.queueMeta,
          queueId: 440,
          maxLobbySize: 5,
          rankSource: "flex",
          duoRules: false,
        },
      },
      {
        ...goldJungler,
        soloTier: null,
        soloDivision: null,
        flexTier: null,
        flexDivision: null,
      },
      prefs,
      creatorGold
    );
    expect(r.reasons).not.toContain("RANK_UNKNOWN");
    expect(r.eligible).toBe(true);
  });

  it("unranked fails when rank bound set and allowUnranked false", () => {
    const r = evaluateEligibility(
      baseListing,
      { ...goldJungler, soloTier: null, soloDivision: null },
      prefs,
      creatorGold
    );
    expect(r.reasons).toContain("RANK_UNKNOWN");
  });

  it("marks off-role without failing", () => {
    const r = evaluateEligibility(
      baseListing,
      { ...goldJungler, primaryRole: "BOTTOM", secondaryRole: "UTILITY" },
      prefs,
      creatorGold,
      "JUNGLE"
    );
    expect(r.eligible).toBe(true);
    expect(r.offRole).toBe(true);
  });

  it("blocks either direction", () => {
    const r = evaluateEligibility(
      baseListing,
      goldJungler,
      prefs,
      creatorGold,
      null,
      { blocked: true }
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("BLOCKED");
  });

  it("treats missing requester languages as no preference", () => {
    const r = evaluateEligibility(baseListing, goldJungler, null, creatorGold);
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain("LANGUAGE_MISMATCH");
  });

  it("treats an empty requester language list as no preference", () => {
    const r = evaluateEligibility(
      baseListing,
      goldJungler,
      { ...prefs, languages: [] },
      creatorGold
    );
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain("LANGUAGE_MISMATCH");
  });

  it("reliability floor skips New accounts", () => {
    const listing = {
      ...baseListing,
      filters: { ...baseListing.filters, minReliability: 80 },
    };
    const newbie = evaluateEligibility(
      listing,
      goldJungler,
      prefs,
      creatorGold,
      null,
      { reliability: null }
    );
    expect(newbie.eligible).toBe(true);
    expect(newbie.provisional).toBe(true);

    const low = evaluateEligibility(
      listing,
      goldJungler,
      prefs,
      creatorGold,
      null,
      { reliability: 50 }
    );
    expect(low.eligible).toBe(false);
    expect(low.reasons).toContain("RELIABILITY_FLOOR");
  });
});

describe("matchScore", () => {
  it("scores same-rank primary role highly", () => {
    const score = matchScore(
      baseListing,
      {
        soloTier: "GOLD",
        soloDivision: "II",
        flexTier: null,
        flexDivision: null,
        primaryRole: "TOP",
        secondaryRole: null,
      },
      goldJungler,
      prefs
    );
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("scores open-slot queues with full role complement", () => {
    const score = matchScore(
      {
        queueId: 450,
        type: "OPEN",
        slots: [{ id: "s1", roles: [], open: true }],
        languages: ["en"],
        queueMeta: {
          queueId: 450,
          gameMode: "ARAM",
          mapId: 12,
          maxLobbySize: 5,
          positional: false,
          isCustom: false,
          rankSource: null,
          duoRules: false,
        },
      },
      {
        soloTier: "GOLD",
        soloDivision: "II",
        flexTier: null,
        flexDivision: null,
        primaryRole: "TOP",
        secondaryRole: null,
      },
      goldJungler,
      prefs
    );
    expect(score).toBe(100);
  });
});
