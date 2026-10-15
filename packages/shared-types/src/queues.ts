import type { Role } from "./profile";
import { queueName } from "./match";

export type RankSource = "solo" | "flex" | null;

/**
 * Fill semantics for a listing — orthogonal to queue/rank rules.
 * Legacy DUO/FLEX/ARAM values are normalized via `normalizeListingType`.
 */
export type ListingType = "POSITIONAL" | "OPEN" | "DUO" | "FLEX" | "ARAM";

export interface LobbyCapability {
  queueId: number;
  gameMode: string | null;
  mapId: number | null;
  maxLobbySize: number;
  /** True when League shows role/position pickers (Solo/Duo, Flex, Clash…). */
  positional: boolean;
  isCustom: boolean;
  rankSource: RankSource;
  /** Enforce Riot Solo/Duo rank-spread rules (queue 420). */
  duoRules: boolean;
  /** Free seats = maxLobbySize - currentMembers (clamped ≥ 0). */
  freeSeats: number;
  memberCount: number;
}

/** Persisted on the listing so eligibility doesn't re-derive from LCU. */
export interface ListingQueueMeta {
  queueId: number;
  gameMode: string | null;
  mapId: number | null;
  maxLobbySize: number;
  positional: boolean;
  isCustom: boolean;
  rankSource: RankSource;
  duoRules: boolean;
}

export interface LcuGameConfigLike {
  queueId?: number | null;
  gameMode?: string | null;
  mapId?: number | null;
  maxLobbySize?: number | null;
  maxTeamSize?: number | null;
  showPositionSelector?: boolean | null;
  showQuickPlaySlotSelection?: boolean | null;
  isCustom?: boolean | null;
  isLobbyFull?: boolean | null;
}

export interface LcuLobbyLike {
  queueId?: number | null;
  partyId?: string | null;
  gameConfig?: LcuGameConfigLike | null;
  members?: unknown[] | null;
  localMember?: unknown | null;
}

/** Known queue defaults when gameConfig fields are missing. */
const QUEUE_DEFAULTS: Record<
  number,
  Partial<Pick<LobbyCapability, "maxLobbySize" | "positional" | "rankSource" | "duoRules">>
> = {
  400: { maxLobbySize: 5, positional: true, rankSource: null, duoRules: false },
  420: { maxLobbySize: 2, positional: true, rankSource: "solo", duoRules: true },
  430: { maxLobbySize: 5, positional: false, rankSource: null, duoRules: false },
  440: { maxLobbySize: 5, positional: true, rankSource: "flex", duoRules: false },
  450: { maxLobbySize: 5, positional: false, rankSource: null, duoRules: false },
  490: { maxLobbySize: 5, positional: false, rankSource: null, duoRules: false },
  700: { maxLobbySize: 5, positional: true, rankSource: "solo", duoRules: false },
  720: { maxLobbySize: 5, positional: false, rankSource: null, duoRules: false },
  1700: { maxLobbySize: 2, positional: false, rankSource: null, duoRules: false },
};

/** Queues we refuse to publish (bots / practice). Empty = allow all with free seats. */
export const DENIED_QUEUE_IDS = new Set<number>([
  830, // Co-op vs AI
  840,
  850,
]);

export function isPublishableQueue(queueId: number | null | undefined): boolean {
  if (queueId == null || Number.isNaN(queueId)) return false;
  if (DENIED_QUEUE_IDS.has(queueId)) return false;
  // Custom lobbies often report queueId 0 / -1
  if (queueId < -1) return false;
  return true;
}

/**
 * Queues that must not create reputation. Practice tool and custom games
 * are not in match-v5 (queue id 0 / -1). Tutorials are.
 */
const NON_REPUTATION_QUEUE_IDS = new Set<number>([0, -1, 2000, 2010, 2020]);

export function isReputationQueue(queueId: number | null | undefined): boolean {
  if (!isPublishableQueue(queueId)) return false;
  if (queueId == null || queueId <= 0) return false;
  if (NON_REPUTATION_QUEUE_IDS.has(queueId)) return false;
  return true;
}

export function getQueueIdFromLobby(lobby: LcuLobbyLike | null | undefined): number | null {
  if (!lobby) return null;
  const q = lobby.gameConfig?.queueId ?? lobby.queueId;
  if (typeof q === "number" && !Number.isNaN(q)) return q;
  if (q != null) {
    const n = Number(q);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function deriveLobbyCapability(
  lobby: LcuLobbyLike | null | undefined
): LobbyCapability | null {
  if (!lobby) return null;
  const gc = lobby.gameConfig ?? {};
  const queueId = getQueueIdFromLobby(lobby);
  if (queueId == null) return null;

  const defaults = QUEUE_DEFAULTS[queueId] ?? {};
  const isCustom = Boolean(gc.isCustom);
  const positional =
    typeof gc.showPositionSelector === "boolean"
      ? gc.showPositionSelector
      : (defaults.positional ?? false);

  let maxLobbySize =
    typeof gc.maxLobbySize === "number" && gc.maxLobbySize > 0
      ? gc.maxLobbySize
      : (defaults.maxLobbySize ??
        (typeof gc.maxTeamSize === "number" && gc.maxTeamSize > 0
          ? gc.maxTeamSize
          : 5));

  // Custom games: prefer team size when maxLobbySize is odd/zero
  if (isCustom && typeof gc.maxTeamSize === "number" && gc.maxTeamSize > 0) {
    maxLobbySize = Math.max(maxLobbySize, gc.maxTeamSize);
  }

  const memberCount = Array.isArray(lobby.members) ? lobby.members.length : 1;
  const freeSeats = Math.max(0, maxLobbySize - memberCount);

  let rankSource: RankSource =
    defaults.rankSource !== undefined
      ? defaults.rankSource
      : queueId === 440
        ? "flex"
        : queueId === 420 || queueId === 700
          ? "solo"
          : null;
  if (isCustom) rankSource = null;

  const duoRules =
    defaults.duoRules !== undefined ? defaults.duoRules : queueId === 420;

  return {
    queueId,
    gameMode: gc.gameMode ?? null,
    mapId: typeof gc.mapId === "number" ? gc.mapId : null,
    maxLobbySize,
    positional,
    isCustom,
    rankSource,
    duoRules,
    freeSeats,
    memberCount,
  };
}

export function capabilityToQueueMeta(cap: LobbyCapability): ListingQueueMeta {
  return {
    queueId: cap.queueId,
    gameMode: cap.gameMode,
    mapId: cap.mapId,
    maxLobbySize: cap.maxLobbySize,
    positional: cap.positional,
    isCustom: cap.isCustom,
    rankSource: cap.rankSource,
    duoRules: cap.duoRules,
  };
}

/** Infer queue meta from a bare queueId (server-side fallback / old rows). */
export function queueMetaFromQueueId(queueId: number): ListingQueueMeta {
  const defaults = QUEUE_DEFAULTS[queueId] ?? {};
  return {
    queueId,
    gameMode: null,
    mapId: null,
    maxLobbySize: defaults.maxLobbySize ?? 5,
    positional: defaults.positional ?? false,
    isCustom: queueId === 0 || queueId === -1,
    rankSource:
      defaults.rankSource !== undefined
        ? defaults.rankSource
        : queueId === 440
          ? "flex"
          : queueId === 420
            ? "solo"
            : null,
    duoRules: defaults.duoRules ?? queueId === 420,
  };
}

export function normalizeListingType(
  type: string | null | undefined,
  meta?: ListingQueueMeta | null
): "POSITIONAL" | "OPEN" {
  if (type === "POSITIONAL" || type === "OPEN") return type;
  if (type === "DUO" || type === "FLEX") return "POSITIONAL";
  if (type === "ARAM") return "OPEN";
  if (meta?.positional) return "POSITIONAL";
  return "OPEN";
}

export function listingTypeFromCapability(cap: LobbyCapability): "POSITIONAL" | "OPEN" {
  return cap.positional ? "POSITIONAL" : "OPEN";
}

export function displayQueueLabel(queueId: number, meta?: ListingQueueMeta | null): string {
  if (meta?.isCustom) return "Custom";
  return queueName(queueId);
}

/** Role set helpers — empty array means any role. */
export const ALL_ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export function slotAcceptsRole(
  roles: Role[] | undefined | null,
  role: Role | null | undefined
): boolean {
  if (!roles || roles.length === 0) return true; // any
  if (!role) return false;
  return roles.includes(role);
}

export function slotPrimaryRole(roles: Role[] | undefined | null): Role | null {
  if (!roles || roles.length === 0) return null;
  return roles[0] ?? null;
}

export function formatSlotRoles(roles: Role[] | undefined | null): string {
  if (!roles || roles.length === 0) return "Any role";
  if (roles.length === 1) return roles[0];
  return `${roles[0]} / ${roles[1]}`;
}

let _slotSeq = 0;
export function newSlotId(): string {
  _slotSeq += 1;
  return `slot_${Date.now().toString(36)}_${_slotSeq.toString(36)}`;
}
