import { DEFAULT_SEASON_START_EPOCH, resolveSeason } from "./season-config";

describe("resolveSeason", () => {
  it("derives the season year from the default epoch when env is unset", () => {
    const resolved = resolveSeason({ get: () => undefined });
    expect(resolved.epoch).toBe(DEFAULT_SEASON_START_EPOCH);
    expect(resolved.season).toBe(
      String(new Date(DEFAULT_SEASON_START_EPOCH * 1000).getUTCFullYear())
    );
    expect(resolved.season).toBe("2025");
    expect(resolved.unset).toEqual(["SEASON_START_EPOCH", "CURRENT_SEASON"]);
  });

  it("keeps an explicit season string", () => {
    const resolved = resolveSeason({
      get: (key) => (key === "CURRENT_SEASON" ? "2026" : "1743465600"),
    });
    expect(resolved.season).toBe("2026");
    expect(resolved.unset).toEqual([]);
  });
});
