import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { ALL_ROLES, TIER_ORDER, eligibilityReasonText, formatSlotRoles, queueName, slotAcceptsRole, } from "@lobly/shared-types";
import { cancelJoin, fetchBoard, requestJoin } from "../api/session";
import { getBridge } from "../shared/bridge";
import { useAppStore } from "../shared/messaging";
import { c, radius, font } from "./theme";
import { Avatar, Button, Card, EmptyState, LoadingBlock, RankBadge, PartyStrip, RoleIcon, Tag, } from "./components";
import { profileIcon, useStaticData } from "./useStaticData";
import { PlayerMenu } from "./PlayerMenu";
const HIDE_KEY = "lobly.board.hideIneligible";
export function BoardView() {
    const sd = useStaticData();
    const app = useAppStore();
    const [rolePick, setRolePick] = useState({});
    const bridge = getBridge();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [hideIneligible, setHideIneligible] = useState(() => {
        try {
            return localStorage.getItem(HIDE_KEY) === "1";
        }
        catch {
            return false;
        }
    });
    const [queueId, setQueueId] = useState("");
    const [role, setRole] = useState("");
    const [minRank, setMinRank] = useState("");
    const [sort, setSort] = useState("score");
    const [revision, setRevision] = useState(0);
    const load = () => {
        setRows(null);
        setError(null);
        const q = { sort };
        if (queueId)
            q.queueId = Number(queueId);
        if (role)
            q.roles = role;
        if (minRank)
            q.minRank = minRank;
        void fetchBoard(q)
            .then(setRows)
            .catch((e) => setError(e?.body?.message ?? e?.message ?? "Failed to load board"));
    };
    useEffect(load, [queueId, role, minRank, sort]);
    // Live board.delta → refetch
    useEffect(() => {
        const store = bridge?.store;
        if (!store)
            return;
        return store.subscribe(() => {
            const rev = store.state.boardRevision ?? 0;
            if (rev !== revision) {
                setRevision(rev);
                load();
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bridge, revision]);
    const visible = useMemo(() => {
        if (!rows)
            return null;
        if (!hideIneligible)
            return rows;
        return rows.filter((r) => r.isOwn || r.eligible);
    }, [rows, hideIneligible]);
    const toggleHide = () => {
        const next = !hideIneligible;
        setHideIneligible(next);
        try {
            localStorage.setItem(HIDE_KEY, next ? "1" : "0");
        }
        catch {
            /* ignore */
        }
    };
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsxs(Card, { pad: 20, style: {
                    overflow: "hidden",
                    position: "relative",
                    background: "radial-gradient(circle at 85% 0%, rgba(155,123,255,.15), transparent 36%), linear-gradient(135deg, rgba(16,31,50,.98), rgba(7,13,23,.98))",
                }, children: [_jsx("div", { "aria-hidden": true, style: {
                            position: "absolute",
                            right: -28,
                            bottom: -58,
                            width: 220,
                            height: 150,
                            border: `1px solid ${c.borderStrong}`,
                            transform: "rotate(-18deg)",
                            opacity: 0.18,
                        } }), _jsxs("div", { style: { display: "flex", alignItems: "flex-end", gap: 18, position: "relative" }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                                            color: c.primary,
                                            fontSize: 9,
                                            fontWeight: 800,
                                            letterSpacing: 1.5,
                                            textTransform: "uppercase",
                                        }, children: "Live team network" }), _jsx("div", { style: { fontSize: 22, fontWeight: 760, marginTop: 5 }, children: "Find your next win condition." }), _jsx("div", { style: { color: c.textDim, maxWidth: 560, marginTop: 5, lineHeight: 1.55 }, children: "Every lobby is verified against a live League account. Filter by the role and competitive fit that matters to you." })] }), _jsxs("div", { style: { marginLeft: "auto", textAlign: "right" }, children: [_jsx("div", { style: { fontFamily: font.mono, fontSize: 28, fontWeight: 800 }, children: visible?.length ?? "—" }), _jsx("div", { style: { color: c.textFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }, children: "open now" })] })] })] }), _jsx(Card, { pad: 13, style: { background: "rgba(9,15,25,.82)" }, children: _jsxs("div", { style: {
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                    }, children: [_jsxs("select", { value: queueId, onChange: (e) => setQueueId(e.target.value), style: filterStyle, children: [_jsx("option", { value: "", children: "All queues" }), _jsx("option", { value: "420", children: "Solo/Duo" }), _jsx("option", { value: "440", children: "Flex" }), _jsx("option", { value: "450", children: "ARAM" }), _jsx("option", { value: "490", children: "Quickplay" }), _jsx("option", { value: "700", children: "Clash" })] }), _jsxs("select", { value: role, onChange: (e) => setRole(e.target.value), style: filterStyle, children: [_jsx("option", { value: "", children: "Any role" }), ALL_ROLES.map((r) => (_jsx("option", { value: r, children: r }, r)))] }), _jsxs("select", { value: minRank, onChange: (e) => setMinRank(e.target.value), style: filterStyle, children: [_jsx("option", { value: "", children: "Creator rank \u2265" }), TIER_ORDER.map((t) => (_jsxs("option", { value: t, children: [t, "+"] }, t)))] }), _jsxs("select", { value: sort, onChange: (e) => setSort(e.target.value), style: filterStyle, children: [_jsx("option", { value: "score", children: "Best match" }), _jsx("option", { value: "newest", children: "Newest" }), _jsx("option", { value: "rank", children: "Highest rank" })] }), _jsxs("label", { style: {
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 12,
                                color: c.textDim,
                                marginLeft: 4,
                            }, children: [_jsx("input", { type: "checkbox", checked: hideIneligible, onChange: toggleHide }), "Hide ones I can't join"] }), _jsx(Button, { size: "sm", onClick: load, style: { marginLeft: "auto" }, children: "\u21BB Refresh" })] }) }), _jsx("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }, children: _jsx("span", { style: { color: c.textDim, fontSize: 13 }, children: visible
                        ? `${visible.length} open ${visible.length === 1 ? "lobby" : "lobbies"}`
                        : " " }) }), rows === null && !error && (_jsx(Card, { children: _jsx(LoadingBlock, { label: "Finding lobbies" }) })), error && (_jsx(Card, { children: _jsx(EmptyState, { title: "Board unavailable", hint: error, action: _jsx(Button, { onClick: load, children: "Try again" }) }) })), visible?.length === 0 && (_jsx(Card, { children: _jsx(EmptyState, { title: "No lobbies right now", hint: "Nobody on your server has an open listing. Create your own from My Lobby and let others find you." }) })), visible?.map((row) => {
                const open = row.listing.slots.find((s) => s.open);
                const openLabel = open
                    ? formatSlotRoles(open.roles)
                    : "Join";
                const dimmed = !row.isOwn && !row.eligible;
                const expiresIn = expiryLabel(row.listing.expiresAt);
                return (_jsxs(Card, { pad: 17, interactive: true, style: {
                        display: "flex",
                        gap: 16,
                        alignItems: "center",
                        opacity: dimmed ? 0.55 : 1,
                        borderColor: row.isOwn ? `${c.primary}66` : undefined,
                        background: row.isOwn
                            ? "linear-gradient(115deg, rgba(66,215,255,.09), rgba(9,15,25,.96) 42%)"
                            : undefined,
                    }, children: [_jsx(Avatar, { url: profileIcon(sd, null), size: 50, ring: row.isOwn ? c.primary : undefined }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [_jsx("span", { style: { fontWeight: 760, fontSize: 15 }, children: row.listing.title }), _jsx(Tag, { color: c.textDim, children: queueName(row.listing.queueId) }), row.isOwn && _jsx(Tag, { color: c.primary, children: "Your lobby" }), row.offRole && !row.isOwn && _jsx(Tag, { color: c.warn, children: "Off-role" }), row.provisional && _jsx(Tag, { color: c.warn, children: "Provisional" }), expiresIn && _jsx(Tag, { color: c.textFaint, children: expiresIn })] }), _jsxs("div", { style: {
                                        display: "flex",
                                        gap: 10,
                                        alignItems: "center",
                                        marginTop: 6,
                                        fontSize: 12,
                                        color: c.textDim,
                                        flexWrap: "wrap",
                                    }, children: [_jsxs("span", { style: { color: c.text, fontWeight: 600 }, children: [row.creator.riotId, _jsxs("span", { style: { color: c.textFaint }, children: ["#", row.creator.tagLine] })] }), _jsx(RankBadge, { tier: row.creator.tier, division: row.creator.division, size: "sm" }), row.creator.primaryRole && (_jsxs("span", { style: { display: "inline-flex", gap: 4, alignItems: "center" }, children: [_jsx(RoleIcon, { role: row.creator.primaryRole, size: 13 }), row.creator.primaryRole] })), _jsxs("span", { children: [row.listing.slots.filter((s) => s.open).length, " open"] }), row.listing.party?.members && (_jsx(PartyStrip, { positional: Boolean(row.listing.queueMeta?.positional), count: row.listing.party.members.length, max: row.listing.queueMeta?.maxLobbySize ?? 5, filled: row.listing.party.members
                                                .map((m) => m.roles[0])
                                                .filter((role) => role != null), open: row.listing.slots.filter((s) => s.open).flatMap((s) => s.roles) })), _jsx("span", { children: row.reliability != null ? `${row.reliability} rel` : "New player" })] }), _jsx("div", { style: { display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }, children: row.listing.slots
                                        .filter((s) => s.open)
                                        .map((s, i) => (_jsx(Tag, { color: c.accent, children: formatSlotRoles(s.roles) }, i))) }), dimmed && row.reasons?.length > 0 && (_jsx("div", { style: { marginTop: 6, fontSize: 11, color: c.warn }, children: row.reasons.map(eligibilityReasonText).join(" · ") }))] }), !row.isOwn && _jsx(MatchScore, { score: row.matchScore }), row.isOwn ? (_jsx(Button, { onClick: () => {
                                const b = getBridge();
                                if (b?.navigate)
                                    b.navigate("listing");
                                else
                                    b?.store.update({ uiTab: "listing" });
                            }, children: "Edit / Unpublish" })) : row.myRequest &&
                            (row.myRequest.status === "PENDING" || row.myRequest.status === "ACCEPTED") ? (_jsx(Button, { disabled: busy === row.listing.id, onClick: async () => {
                                setBusy(row.listing.id);
                                try {
                                    await cancelJoin(row.myRequest.id);
                                    getBridge()?.setToast("Request cancelled");
                                }
                                catch (e) {
                                    getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Couldn't cancel");
                                }
                                finally {
                                    setBusy(null);
                                }
                            }, children: "Requested \u00B7 Cancel" })) : (_jsx(JoinButton, { row: row, busy: busy === row.listing.id, choices: joinRoleChoices(row, app.profileHints?.primaryRole, app.profileHints?.secondaryRole), picked: rolePick[row.listing.id], onPick: (role) => setRolePick((cur) => ({ ...cur, [row.listing.id]: role })), openLabel: openLabel, onJoin: async (joinRole) => {
                                setBusy(row.listing.id);
                                try {
                                    const r = await requestJoin(row.listing.id, joinRole);
                                    getBridge()?.setToast(`Request sent · match score ${r.matchScore}`);
                                }
                                catch (e) {
                                    const reasons = e?.body?.reasons;
                                    getBridge()?.setToast(Array.isArray(reasons) && reasons.length
                                        ? `Can't join: ${reasons.map(eligibilityReasonText).join(", ")}`
                                        : (e?.body?.message ?? e?.message ?? "Join failed"));
                                }
                                finally {
                                    setBusy(null);
                                }
                            } })), !row.isOwn && (_jsx(PlayerMenu, { accountId: row.listing.creatorAccountId, listingId: row.listing.id }))] }, row.listing.id));
            })] }));
}
const filterStyle = {
    background: c.surfaceAlt,
    border: `1px solid ${c.border}`,
    borderRadius: radius.md,
    color: c.text,
    padding: "8px 11px",
    fontSize: 12,
};
function joinRoleChoices(row, primary, secondary) {
    const open = row.listing.slots.filter((s) => s.open);
    if (!open.length)
        return [];
    if (open.every((s) => !s.roles || s.roles.length === 0))
        return [];
    const prefs = [primary, secondary].filter((r) => !!r && ALL_ROLES.includes(r));
    const accepted = [];
    for (const role of prefs) {
        if (open.some((s) => slotAcceptsRole(s.roles, role)) && !accepted.includes(role)) {
            accepted.push(role);
        }
    }
    if (accepted.length)
        return accepted;
    const fallback = open.find((s) => s.roles.length > 0)?.roles[0];
    return fallback ? [fallback] : [];
}
function JoinButton({ row, busy, choices, picked, onPick, openLabel, onJoin, }) {
    const role = choices.length > 1 ? (picked ?? choices[0]) : choices[0];
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }, children: [choices.length > 1 && (_jsx("select", { value: role, onChange: (e) => onPick(e.target.value), style: { ...filterStyle, padding: "4px 8px" }, children: choices.map((r) => (_jsx("option", { value: r, children: r }, r))) })), _jsx(Button, { variant: "primary", disabled: busy || !row.eligible, title: !row.eligible ? row.reasons.map(eligibilityReasonText).join(", ") : undefined, onClick: () => onJoin(role), children: busy ? "Sending…" : !row.eligible ? "Can't join" : choices.length ? `Join ${role}` : `Join ${openLabel}` })] }));
}
function expiryLabel(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0)
        return "Expired";
    const m = Math.ceil(ms / 60_000);
    if (m > 120)
        return null;
    return m >= 60 ? `${Math.floor(m / 60)}h left` : `${m}m left`;
}
function MatchScore({ score }) {
    const col = score >= 75 ? c.win : score >= 50 ? c.accent : c.textDim;
    const size = 56;
    const r = 23;
    const circumference = 2 * Math.PI * r;
    return (_jsxs("div", { style: { position: "relative", width: size, height: size, flexShrink: 0 }, children: [_jsxs("svg", { width: size, height: size, style: { transform: "rotate(-90deg)" }, children: [_jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: c.surfaceAlt, strokeWidth: 3 }), _jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: col, strokeWidth: 3, strokeLinecap: "round", strokeDasharray: circumference, strokeDashoffset: circumference * (1 - score / 100) })] }), _jsxs("div", { style: {
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: font.mono,
                }, children: [_jsx("span", { style: { fontSize: 16, fontWeight: 800, color: col, lineHeight: 1 }, children: score }), _jsx("span", { style: { fontSize: 8, color: c.textFaint, letterSpacing: 0.4 }, children: "MATCH" })] })] }));
}
