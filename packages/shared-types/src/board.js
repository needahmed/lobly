import { newSlotId, normalizeListingType } from "./queues";
export const ELIGIBILITY_REASON_TEXT = {
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
export function eligibilityReasonText(code) {
    return ELIGIBILITY_REASON_TEXT[code] ?? code;
}
/** Upgrade legacy `{ role, open }` slots and ensure ids/roles arrays. */
export function normalizeSlot(raw, index = 0) {
    const s = (raw && typeof raw === "object" ? raw : {});
    let roles = Array.isArray(s.roles) ? [...s.roles] : [];
    if (roles.length === 0 && s.role)
        roles = [s.role];
    return {
        id: typeof s.id === "string" && s.id ? s.id : `legacy_${index}`,
        roles,
        open: Boolean(s.open),
        pendingAccountId: s.pendingAccountId ?? null,
        ...(s.closedReason ? { closedReason: s.closedReason } : {}),
    };
}
export function normalizeSlots(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((s, i) => normalizeSlot(s, i));
}
export function makeOpenSlots(count, roles = []) {
    const n = Math.max(0, Math.min(4, Math.floor(count)));
    return Array.from({ length: n }, () => ({
        id: newSlotId(),
        roles: [...roles],
        open: true,
        pendingAccountId: null,
    }));
}
export function summarizeListingType(type, meta) {
    return normalizeListingType(type, meta);
}
