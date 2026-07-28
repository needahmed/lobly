import type { ListingStatus } from "./listing";
import type { Role } from "./profile";
import type { ListingQueueMeta, ListingType } from "./queues";
import { newSlotId, normalizeListingType } from "./queues";

export type { ListingType, ListingQueueMeta } from "./queues";

export interface ListingSlot {
  /** Stable id for edit + accept targeting. */
  id: string;
  /**
   * Ordered role preferences: [0]=primary, [1]=secondary.
   * Empty array = any role is fine.
   */
  roles: Role[];
  open: boolean;
  pendingAccountId?: string | null;
  /**
   * @deprecated Legacy single-role field. Prefer `roles`.
   * Kept optional so old JSONB rows still parse; use normalizeSlot().
   */
  role?: Role;
}

export interface ListingFilters {
  minTier?: string;
  minDivision?: string;
  maxTier?: string;
  maxDivision?: string;
  minGames?: number;
  minReliability?: number;
  /** When false (default), unranked players fail if any rank bound is set. */
  allowUnranked?: boolean;
}

export interface CreateListingBody {
  riotAccountId: string;
  queueId: number;
  type: ListingType;
  title: string;
  description?: string;
  slots: ListingSlot[];
  filters: ListingFilters;
  voiceRequired: boolean;
  languages: string[];
  durationMin: 15 | 30 | 60;
  /** Derived lobby capability snapshot — server validates / clamps. */
  queueMeta?: ListingQueueMeta;
}

export interface PatchListingBody {
  title?: string;
  description?: string;
  filters?: ListingFilters;
  slots?: ListingSlot[];
  voiceRequired?: boolean;
  languages?: string[];
  durationMin?: 15 | 30 | 60;
}

export interface ListingStateBody {
  event: "pause" | "relist" | "delist" | "ready" | "reopen";
  phase?: string;
}

export interface ListingSummary {
  id: string;
  creatorAccountId: string;
  platform: string;
  queueId: number;
  type: ListingType;
  title: string;
  description: string | null;
  status: ListingStatus;
  filters: ListingFilters;
  slots: ListingSlot[];
  voiceRequired: boolean;
  languages: string[];
  expiresAt: string;
  createdAt: string;
  queueMeta?: ListingQueueMeta | null;
}

export interface BoardCreatorCard {
  riotId: string;
  tagLine: string;
  platform: string;
  tier: string | null;
  division: string | null;
  lp: number | null;
  primaryRole: Role | null;
  topChampions: { championId: number; name?: string; iconUrl?: string }[];
  formWr20: number | null;
}

export interface BoardRow {
  listing: ListingSummary;
  creator: BoardCreatorCard;
  matchScore: number;
  offRole: boolean;
  eligible: boolean;
  reasons: string[];
  provisional?: boolean;
  reliability?: number | null;
  /** Present when this row is the viewer's own listing. */
  isOwn?: boolean;
}

export type BoardSort = "score" | "newest" | "rank";

export const ELIGIBILITY_REASON_TEXT: Record<string, string> = {
  PLATFORM_MISMATCH: "Different region",
  RANK_UNKNOWN: "Ranked required (you're unranked)",
  RANK_TOO_LOW: "Rank too low for this lobby",
  RANK_TOO_HIGH: "Rank too high for this lobby",
  DUO_ILLEGAL: "Duo rank spread too wide",
  NO_OPEN_SLOTS: "Lobby is full",
  ROLE_SLOT_CLOSED: "No open slot for your role",
  LANGUAGE_MISMATCH: "Language doesn't match",
  VOICE_REQUIRED: "Voice required",
  GAMES_FLOOR: "Not enough games this season",
  BLOCKED: "Blocked",
  RELIABILITY_FLOOR: "Reliability too low",
};

export function eligibilityReasonText(code: string): string {
  return ELIGIBILITY_REASON_TEXT[code] ?? code;
}

/** Upgrade legacy `{ role, open }` slots and ensure ids/roles arrays. */
export function normalizeSlot(raw: unknown, index = 0): ListingSlot {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<ListingSlot> & {
    role?: Role;
  };
  let roles: Role[] = Array.isArray(s.roles) ? [...s.roles] : [];
  if (roles.length === 0 && s.role) roles = [s.role];
  return {
    id: typeof s.id === "string" && s.id ? s.id : `legacy_${index}`,
    roles,
    open: Boolean(s.open),
    pendingAccountId: s.pendingAccountId ?? null,
  };
}

export function normalizeSlots(raw: unknown): ListingSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => normalizeSlot(s, i));
}

export function makeOpenSlots(count: number, roles: Role[] = []): ListingSlot[] {
  const n = Math.max(0, Math.min(4, Math.floor(count)));
  return Array.from({ length: n }, () => ({
    id: newSlotId(),
    roles: [...roles],
    open: true,
    pendingAccountId: null,
  }));
}

export function summarizeListingType(
  type: ListingType | string | null | undefined,
  meta?: ListingQueueMeta | null
): "POSITIONAL" | "OPEN" {
  return normalizeListingType(type, meta);
}
