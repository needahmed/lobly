import type {
  ListingQueueMeta,
  ListingSlot,
  Role,
  UserPrefs,
} from "@lobly/shared-types";
import {
  normalizeSlots,
  queueMetaFromQueueId,
  slotAcceptsRole,
} from "@lobly/shared-types";
import { rankToInt } from "../profile/rank-math";

/** Match Score v1 weights — Phase 3+ may tune these. */
export const MATCH_SCORE_WEIGHTS = {
  RANK: 50,
  ROLE: 30,
  LANGUAGE: 20,
} as const;

export interface MatchScoreListing {
  queueId: number;
  type: string;
  slots: ListingSlot[];
  languages: string[];
  queueMeta?: ListingQueueMeta | null;
}

export interface MatchScoreSnap {
  soloTier: string | null;
  soloDivision: string | null;
  flexTier: string | null;
  flexDivision: string | null;
  primaryRole: Role | null;
  secondaryRole: Role | null;
}

/**
 * matchScore 0..100 = round(50*rankProximity + 30*roleComplement + 20*languageMatch)
 */
export function matchScore(
  listing: MatchScoreListing,
  creator: MatchScoreSnap,
  viewer: MatchScoreSnap,
  viewerPrefs: UserPrefs | null
): number {
  const meta =
    listing.queueMeta && listing.queueMeta.queueId != null
      ? listing.queueMeta
      : queueMetaFromQueueId(listing.queueId);

  const useFlex = meta.rankSource === "flex";
  // Positionless / no-rank-source queues give full rank proximity (neutral)
  const rankNeutral = meta.rankSource == null;

  let rankProximity = 1;
  if (!rankNeutral) {
    const cInt = rankToInt(
      useFlex ? creator.flexTier : creator.soloTier,
      useFlex ? creator.flexDivision : creator.soloDivision
    );
    const vInt = rankToInt(
      useFlex ? viewer.flexTier : viewer.soloTier,
      useFlex ? viewer.flexDivision : viewer.soloDivision
    );
    if (cInt == null || vInt == null) {
      rankProximity = 0.5;
    } else {
      rankProximity = Math.max(0, 1 - Math.abs(cInt - vInt) / 8);
    }
  }

  const openSlots = normalizeSlots(listing.slots).filter((s) => s.open);
  let roleComplement = 0.3;
  if (!meta.positional) {
    // Open-slot queues: any player fits — full role score
    roleComplement = openSlots.length ? 1.0 : 0.3;
  } else if (
    viewer.primaryRole &&
    openSlots.some((s) => slotAcceptsRole(s.roles, viewer.primaryRole))
  ) {
    // Prefer primary match on a slot whose primary role matches
    const primaryHit = openSlots.some(
      (s) =>
        s.roles.length > 0 &&
        s.roles[0] === viewer.primaryRole
    );
    roleComplement = primaryHit ? 1.0 : 0.9;
  } else if (
    viewer.secondaryRole &&
    openSlots.some((s) => slotAcceptsRole(s.roles, viewer.secondaryRole))
  ) {
    roleComplement = 0.7;
  } else if (openSlots.some((s) => s.roles.length === 0)) {
    // Any-role slot available
    roleComplement = 0.85;
  }

  let languageMatch = 1.0;
  if (listing.languages?.length) {
    const prefs = viewerPrefs?.languages ?? [];
    const hit = listing.languages.some((l) =>
      prefs.map((x) => x.toLowerCase()).includes(l.toLowerCase())
    );
    languageMatch = hit ? 1.0 : 0.0;
  }

  return Math.round(
    MATCH_SCORE_WEIGHTS.RANK * rankProximity +
      MATCH_SCORE_WEIGHTS.ROLE * roleComplement +
      MATCH_SCORE_WEIGHTS.LANGUAGE * languageMatch
  );
}
