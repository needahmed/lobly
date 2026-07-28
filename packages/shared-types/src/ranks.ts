/** Shared rank ladder — used by eligibility, duo legality, and publish UI. */

export const TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;

export type TierName = (typeof TIER_ORDER)[number];

export const DIVISION_ORDER = ["IV", "III", "II", "I"] as const;

export type DivisionName = (typeof DIVISION_ORDER)[number];

const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

export function tierIndex(tier: string | null | undefined): number {
  if (!tier) return -1;
  return TIER_ORDER.indexOf(tier.toUpperCase() as TierName);
}

export function divisionIndex(division: string | null | undefined): number {
  if (!division) return 0;
  const i = DIVISION_ORDER.indexOf(
    division.toUpperCase() as DivisionName
  );
  return i < 0 ? 0 : i;
}

/** Single integer: tierIndex*4 + divisionIndex. Apex tiers use division 0. */
export function rankToInt(
  tier: string | null | undefined,
  division: string | null | undefined
): number | null {
  const ti = tierIndex(tier);
  if (ti < 0) return null;
  const t = tier!.toUpperCase();
  if (APEX.has(t)) return ti * 4;
  return ti * 4 + divisionIndex(division);
}

export function isApexTier(tier: string | null | undefined): boolean {
  return Boolean(tier && APEX.has(tier.toUpperCase()));
}

export function intToRank(n: number): { tier: string; division: string } {
  const ti = Math.max(0, Math.min(TIER_ORDER.length - 1, Math.floor(n / 4)));
  const tier = TIER_ORDER[ti];
  if (APEX.has(tier)) return { tier, division: "I" };
  const di = Math.max(0, Math.min(3, n % 4));
  return { tier, division: DIVISION_ORDER[di] };
}

/**
 * Solo/Duo legality window for a creator:
 * - IRON..EMERALD → ±1 tier
 * - DIAMOND → within 2 divisions
 * - MASTER+ → null (duo not allowed)
 */
export function duoLegalRange(
  tier: string | null | undefined,
  division: string | null | undefined
): { minInt: number; maxInt: number } | null {
  if (!tier || isApexTier(tier)) return null;
  const cInt = rankToInt(tier, division);
  if (cInt == null) return null;

  const cTier = tierIndex(tier);
  const diamondIdx = tierIndex("DIAMOND");
  const emeraldIdx = tierIndex("EMERALD");

  if (cTier <= emeraldIdx) {
    const minTier = Math.max(0, cTier - 1);
    const maxTier = Math.min(emeraldIdx, cTier + 1);
    return {
      minInt: minTier * 4, // IV of lowest allowed tier
      maxInt: maxTier * 4 + 3, // I of highest allowed tier
    };
  }

  if (cTier === diamondIdx) {
    return { minInt: cInt - 2, maxInt: cInt + 2 };
  }

  return null;
}
