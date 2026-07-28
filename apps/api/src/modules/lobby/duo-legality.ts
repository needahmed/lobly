import {
  duoLegalRange as sharedDuoLegalRange,
  isApexTier,
  rankToInt,
  tierIndex,
} from "@lobly/shared-types";

/**
 * MVP Solo/Duo legality (queue 420):
 * IRON..EMERALD → within ±1 tier
 * DIAMOND → within 2 divisions
 * MASTER+ → duo not allowed
 */
export function duoLegal(
  creatorTier: string | null,
  creatorDivision: string | null,
  requesterTier: string | null,
  requesterDivision: string | null
): boolean {
  if (!creatorTier || !requesterTier) return false;
  if (isApexTier(creatorTier) || isApexTier(requesterTier)) return false;

  const cTier = tierIndex(creatorTier);
  const rTier = tierIndex(requesterTier);
  if (cTier < 0 || rTier < 0) return false;

  const diamondIdx = tierIndex("DIAMOND");
  const emeraldIdx = tierIndex("EMERALD");

  if (cTier <= emeraldIdx && rTier <= emeraldIdx) {
    return Math.abs(cTier - rTier) <= 1;
  }

  if (cTier === diamondIdx || rTier === diamondIdx) {
    const cInt = rankToInt(creatorTier, creatorDivision);
    const rInt = rankToInt(requesterTier, requesterDivision);
    if (cInt == null || rInt == null) return false;
    return Math.abs(cInt - rInt) <= 2;
  }

  return false;
}

/** Actual Solo/Duo legal window for a creator (null if Master+). */
export function duoLegalRange(
  creatorTier: string | null,
  creatorDivision: string | null
): { minInt: number; maxInt: number } | null {
  return sharedDuoLegalRange(creatorTier, creatorDivision);
}

/**
 * Clamp a creator-chosen rank filter into the duo-legal window.
 * Returns null ints when duo is impossible (Master+).
 */
export function clampFilterToDuoLegality(
  creatorTier: string | null,
  creatorDivision: string | null,
  minInt: number | null,
  maxInt: number | null
): { minInt: number | null; maxInt: number | null } {
  const range = duoLegalRange(creatorTier, creatorDivision);
  if (!range) {
    return { minInt: Number.POSITIVE_INFINITY, maxInt: Number.NEGATIVE_INFINITY };
  }
  return {
    minInt: minInt == null ? range.minInt : Math.max(minInt, range.minInt),
    maxInt: maxInt == null ? range.maxInt : Math.min(maxInt, range.maxInt),
  };
}
