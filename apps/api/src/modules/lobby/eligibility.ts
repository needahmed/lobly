import type {
  ListingFilters,
  ListingQueueMeta,
  ListingSlot,
  ListingType,
  Role,
  UserPrefs,
} from "@lobly/shared-types";
import {
  normalizeSlots,
  queueMetaFromQueueId,
  slotAcceptsRole,
} from "@lobly/shared-types";
import { rankToInt } from "../profile/rank-math";
import { duoLegal } from "./duo-legality";

export interface EligibilityListing {
  platform: string;
  queueId: number;
  type: ListingType | string;
  filters: ListingFilters;
  slots: ListingSlot[];
  voiceRequired: boolean;
  languages: string[];
  queueMeta?: ListingQueueMeta | null;
}

export interface EligibilitySnapshot {
  platform: string;
  soloTier: string | null;
  soloDivision: string | null;
  flexTier: string | null;
  flexDivision: string | null;
  primaryRole: Role | null;
  secondaryRole: Role | null;
  gamesThisSeason: number | null;
}

export interface CreatorRank {
  soloTier: string | null;
  soloDivision: string | null;
}

export interface EligibilityExtras {
  blocked?: boolean;
  reliability?: number | null;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  offRole: boolean;
  provisional?: boolean;
}

function resolveMeta(listing: EligibilityListing): ListingQueueMeta {
  if (listing.queueMeta && listing.queueMeta.queueId != null) {
    return listing.queueMeta;
  }
  return queueMetaFromQueueId(listing.queueId);
}

/**
 * Pure filter engine — collect ALL failing reasons, don't short-circuit.
 */
export function evaluateEligibility(
  listing: EligibilityListing,
  requester: EligibilitySnapshot,
  requesterPrefs: UserPrefs | null,
  creatorRank: CreatorRank,
  requestedRole?: Role | null,
  extras: EligibilityExtras = {}
): EligibilityResult {
  const reasons: string[] = [];
  let offRole = false;
  const meta = resolveMeta(listing);
  const slots = normalizeSlots(listing.slots);

  // 1. Platform match
  if (requester.platform !== listing.platform) {
    reasons.push("PLATFORM_MISMATCH");
  }

  // 2. Rank range — applies whenever the creator set bounds (including ARAM/custom).
  //    Rank source: flex for flex queues, otherwise solo. Positionless queues still
  //    use solo rank when a filter is set.
  const useFlex = meta.rankSource === "flex";
  const tier = useFlex ? requester.flexTier : requester.soloTier;
  const division = useFlex ? requester.flexDivision : requester.soloDivision;
  const viewerInt = rankToInt(tier, division);
  const hasMin = Boolean(listing.filters.minTier);
  const hasMax = Boolean(listing.filters.maxTier);
  const hasRankBound = hasMin || hasMax;
  const allowUnranked = listing.filters.allowUnranked === true;

  if (hasRankBound) {
    const minInt = hasMin
      ? rankToInt(listing.filters.minTier ?? null, listing.filters.minDivision ?? "IV")
      : null;
    const maxInt = hasMax
      ? rankToInt(listing.filters.maxTier ?? null, listing.filters.maxDivision ?? "I")
      : null;

    if (viewerInt == null) {
      if (!allowUnranked) reasons.push("RANK_UNKNOWN");
    } else {
      if (minInt != null && viewerInt < minInt) reasons.push("RANK_TOO_LOW");
      if (maxInt != null && viewerInt > maxInt) reasons.push("RANK_TOO_HIGH");
    }
  }

  // 3. Duo legality (queue meta flag)
  if (meta.duoRules) {
    const ok = duoLegal(
      creatorRank.soloTier,
      creatorRank.soloDivision,
      requester.soloTier,
      requester.soloDivision
    );
    if (!ok) reasons.push("DUO_ILLEGAL");
  }

  // 4. Role / open slot
  const openSlots = slots.filter((s) => s.open);

  const role =
    requestedRole ??
    ([requester.primaryRole, requester.secondaryRole].find((r) =>
      openSlots.some((s) => slotAcceptsRole(s.roles, r))
    ) as Role | undefined) ??
    null;

  if (openSlots.length === 0) {
    reasons.push("NO_OPEN_SLOTS");
  } else if (role && !openSlots.some((s) => slotAcceptsRole(s.roles, role))) {
    reasons.push("ROLE_SLOT_CLOSED");
  } else if (
    meta.positional &&
    role == null &&
    openSlots.every((s) => s.roles.length > 0) &&
    !openSlots.some((s) =>
      slotAcceptsRole(s.roles, requester.primaryRole) ||
      slotAcceptsRole(s.roles, requester.secondaryRole)
    )
  ) {
    // All slots are role-locked and viewer matches none
    reasons.push("ROLE_SLOT_CLOSED");
  }

  if (role) {
    const mains = new Set(
      [requester.primaryRole, requester.secondaryRole].filter(Boolean) as Role[]
    );
    // Off-role if the matched slot's primary isn't one of the viewer's mains
    // (any-role slots never mark off-role)
    const matched = openSlots.find((s) => slotAcceptsRole(s.roles, role));
    if (matched && matched.roles.length > 0) {
      offRole = !mains.has(role);
    }
  }

  // 5. Languages. An empty or missing requester list is "no preference".
  const prefsLangs = requesterPrefs?.languages ?? [];
  if (listing.languages?.length && prefsLangs.length > 0) {
    const overlap = listing.languages.some((l) =>
      prefsLangs.map((x) => x.toLowerCase()).includes(l.toLowerCase())
    );
    if (!overlap) reasons.push("LANGUAGE_MISMATCH");
  }

  // 6. Voice
  if (listing.voiceRequired) {
    if (!requesterPrefs || requesterPrefs.voice === "NO_VOICE") {
      reasons.push("VOICE_REQUIRED");
    }
  }

  // 7. Games floor
  const minGames = listing.filters.minGames ?? 0;
  if ((requester.gamesThisSeason ?? 0) < minGames) {
    reasons.push("GAMES_FLOOR");
  }

  // 8. Blocks
  if (extras.blocked) {
    reasons.push("BLOCKED");
  }

  // 9. Reliability floor — "New" (null) accounts pass
  const minRel = listing.filters.minReliability;
  if (
    minRel != null &&
    extras.reliability != null &&
    extras.reliability < minRel
  ) {
    reasons.push("RELIABILITY_FLOOR");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    offRole,
    provisional: extras.reliability == null,
  };
}
