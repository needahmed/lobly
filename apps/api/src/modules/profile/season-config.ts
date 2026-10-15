/** 2025-04-01T00:00:00.000Z — used when SEASON_START_EPOCH is unset. */
export const DEFAULT_SEASON_START_EPOCH = 1743465600;

export interface SeasonConfig {
  epoch: number;
  season: string;
  unset: Array<"SEASON_START_EPOCH" | "CURRENT_SEASON">;
}

export function resolveSeason(config: { get(key: string): unknown }): SeasonConfig {
  const rawEpoch = config.get("SEASON_START_EPOCH");
  const rawSeason = config.get("CURRENT_SEASON");
  const unset: SeasonConfig["unset"] = [];
  const epochMissing = rawEpoch == null || rawEpoch === "";
  const seasonMissing = rawSeason == null || rawSeason === "";
  if (epochMissing) unset.push("SEASON_START_EPOCH");
  if (seasonMissing) unset.push("CURRENT_SEASON");

  const parsed = epochMissing ? DEFAULT_SEASON_START_EPOCH : Number(rawEpoch);
  const epoch = Number.isFinite(parsed) ? parsed : DEFAULT_SEASON_START_EPOCH;
  const derived = String(new Date(epoch * 1000).getUTCFullYear());
  return {
    epoch,
    season: seasonMissing ? derived : String(rawSeason),
    unset,
  };
}
