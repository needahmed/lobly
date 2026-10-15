import { computeReliabilityScore, isProvisional } from "./reliability";

describe("computeReliabilityScore", () => {
  it("returns null with no events", () => {
    expect(computeReliabilityScore([])).toBeNull();
  });

  it("applies no-show and abandon penalties", () => {
    const score = computeReliabilityScore([
      { kind: "NO_SHOW" },
      { kind: "ABANDONED" },
      { kind: "SHOWED" },
      { kind: "COMPLETED" },
    ]);
    // 100 - 15 - 20 + 1 + 2 = 68
    expect(score).toBe(68);
  });

  it("weights CANCELLED_AFTER_ACCEPT as -5 and clamps to 0..100", () => {
    expect(
      computeReliabilityScore([{ kind: "CANCELLED_AFTER_ACCEPT" }])
    ).toBe(95);
    const many = Array.from({ length: 30 }, () => ({
      kind: "CANCELLED_AFTER_ACCEPT",
    }));
    expect(computeReliabilityScore(many)).toBe(0);
  });

  it("caps bonuses at +10 each", () => {
    const events = [
      ...Array.from({ length: 20 }, () => ({ kind: "SHOWED" })),
      ...Array.from({ length: 20 }, () => ({ kind: "COMPLETED" })),
    ];
    expect(computeReliabilityScore(events)).toBe(100);
  });
});

describe("isProvisional", () => {
  it("flags new / low level / no ranked games", () => {
    expect(
      isProvisional({ reliability: null, summonerLevel: 50, gamesThisSeason: 10 })
    ).toBe(true);
    expect(
      isProvisional({ reliability: 90, summonerLevel: 20, gamesThisSeason: 10 })
    ).toBe(true);
    expect(
      isProvisional({ reliability: 90, summonerLevel: 50, gamesThisSeason: 0 })
    ).toBe(true);
    expect(
      isProvisional({ reliability: 90, summonerLevel: 50, gamesThisSeason: 10 })
    ).toBe(false);
  });
});
