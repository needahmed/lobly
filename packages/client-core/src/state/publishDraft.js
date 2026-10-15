import { ALL_ROLES, capabilityToQueueMeta, duoLegalRange, intToRank, listingTypeFromCapability, makeOpenSlots, newSlotId, queueName, rankToInt, } from "@lobly/shared-types";
/** Signature of the lobby traits a draft depends on. */
export function capabilitySignature(cap) {
    return [cap.queueId, cap.positional, cap.maxLobbySize, cap.duoRules].join(":");
}
const STORAGE_KEY = "lobly.publishDraft.v2";
function loadAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return {};
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
export function loadDraftForQueue(queueId) {
    const saved = loadAll()[String(queueId)];
    if (!saved)
        return null;
    // Older saved drafts predate `queueId`; stamp it so callers can trust it.
    return { ...saved, queueId };
}
export function saveDraftForQueue(queueId, draft) {
    try {
        const all = loadAll();
        all[String(queueId)] = draft;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
    catch {
        /* ignore */
    }
}
export function defaultDraft(cap, opts) {
    const maxSlots = Math.max(1, Math.min(4, cap.freeSeats || cap.maxLobbySize - 1));
    const slotCount = cap.positional
        ? Math.min(1, maxSlots) // Solo/Duo defaults to 1; Flex user can bump
        : Math.min(Math.max(1, cap.freeSeats), maxSlots);
    const slotRoles = [];
    for (let i = 0; i < slotCount; i++) {
        if (cap.positional && i === 0) {
            // Looking for complement of creator's roles by default → any
            slotRoles.push([]);
        }
        else {
            slotRoles.push([]);
        }
    }
    const typeLabel = cap.duoRules
        ? "Duo"
        : cap.isCustom
            ? "Custom"
            : cap.rankSource === "flex"
                ? "Flex"
                : !cap.positional
                    ? queueName(cap.queueId)
                    : queueName(cap.queueId);
    return {
        queueId: cap.queueId,
        title: `${opts?.gameName ?? "LOBLY"} looking for ${typeLabel}`,
        description: "",
        slotCount,
        slotRoles,
        rankPreset: "any",
        filters: {},
        voiceRequired: false,
        languages: opts?.languages?.length ? opts.languages : ["en"],
        durationMin: 30,
    };
}
/** Keep a user's edits but re-clamp anything the new lobby no longer allows. */
export function reconcileDraftToCapability(draft, cap) {
    const maxSlots = Math.max(1, Math.min(4, Math.max(1, cap.freeSeats)));
    const slotCount = Math.max(1, Math.min(maxSlots, draft.slotCount));
    if (slotCount === draft.slotCount && draft.queueId === cap.queueId) {
        return draft;
    }
    return {
        ...draft,
        queueId: cap.queueId,
        slotCount,
        slotRoles: resizeSlotRoles(draft.slotRoles, slotCount),
    };
}
export function clampSlotCount(cap, n) {
    const max = Math.max(1, Math.min(4, Math.max(1, cap.freeSeats)));
    return Math.max(1, Math.min(max, Math.floor(n)));
}
export function resizeSlotRoles(roles, count) {
    const next = roles.slice(0, count);
    while (next.length < count)
        next.push([]);
    return next;
}
export function applyRankPreset(preset, creatorTier, creatorDivision, duoRules) {
    if (preset === "any")
        return { allowUnranked: true };
    if (preset === "custom")
        return {};
    const cInt = rankToInt(creatorTier, creatorDivision);
    if (cInt == null)
        return { allowUnranked: true };
    if (preset === "near") {
        let minInt = cInt - 4;
        let maxInt = cInt + 4;
        if (duoRules) {
            const range = duoLegalRange(creatorTier, creatorDivision);
            if (range) {
                minInt = Math.max(minInt, range.minInt);
                maxInt = Math.min(maxInt, range.maxInt);
            }
        }
        const min = intToRank(minInt);
        const max = intToRank(maxInt);
        return {
            minTier: min.tier,
            minDivision: min.division,
            maxTier: max.tier,
            maxDivision: max.division,
            allowUnranked: false,
        };
    }
    // above
    const min = intToRank(cInt);
    let filters = {
        minTier: min.tier,
        minDivision: min.division,
        allowUnranked: false,
    };
    if (duoRules) {
        const range = duoLegalRange(creatorTier, creatorDivision);
        if (range) {
            const max = intToRank(range.maxInt);
            filters = {
                ...filters,
                maxTier: max.tier,
                maxDivision: max.division,
            };
        }
    }
    return filters;
}
export function draftToSlots(draft) {
    const count = Math.max(1, Math.min(4, draft.slotCount));
    const roles = resizeSlotRoles(draft.slotRoles, count);
    return roles.map((r) => ({
        id: newSlotId(),
        roles: r.filter((x) => ALL_ROLES.includes(x)),
        open: true,
        pendingAccountId: null,
    }));
}
export function draftToCreateBody(draft, cap, riotAccountId) {
    return {
        riotAccountId,
        queueId: cap.queueId,
        type: listingTypeFromCapability(cap),
        title: draft.title.trim() || "LOBLY lobby",
        description: draft.description.trim() || undefined,
        slots: draftToSlots(draft),
        filters: draft.filters,
        voiceRequired: draft.voiceRequired,
        languages: draft.languages.length ? draft.languages : ["en"],
        durationMin: draft.durationMin,
        queueMeta: capabilityToQueueMeta(cap),
    };
}
export function slotsFromDraftOrMake(cap, draft) {
    if (draft.slotCount > 0)
        return draftToSlots(draft);
    return makeOpenSlots(Math.min(1, cap.freeSeats), []);
}
