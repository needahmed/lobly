import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { queueName } from "@lobly/shared-types";
import { fetchMatchHistory } from "../api/session";
import { c, radius, font } from "./theme";
import { Avatar, Card, EmptyState, LoadingBlock, RoleIcon, Tag, } from "./components";
import { championDisplayName, championIcon, itemIcon, runeIcon, spellIcon, useStaticData, } from "./useStaticData";
export const MATCH_QUEUE_FILTERS = [
    { label: "All", analyticsLabel: "All queues" },
    { label: "Ranked Solo", analyticsLabel: "Ranked Solo", queueId: 420 },
    { label: "Flex", analyticsLabel: "Flex", queueId: 440 },
    { label: "ARAM", analyticsLabel: "ARAM", queueId: 450 },
];
export function matchQueueLabel(queueId) {
    return (MATCH_QUEUE_FILTERS.find((filter) => filter.queueId === queueId)?.analyticsLabel ??
        queueName(queueId ?? 0));
}
export function MatchHistory({ riotAccountId, rows: controlledRows, error: controlledError, queueId: controlledQueueId, onQueueChange, fetchedCount, }) {
    const sd = useStaticData();
    const [localRows, setLocalRows] = useState(null);
    const [localError, setLocalError] = useState(null);
    const [localQueueId, setLocalQueueId] = useState(undefined);
    const [expanded, setExpanded] = useState(null);
    const isControlled = controlledRows !== undefined;
    const rows = isControlled ? controlledRows : localRows;
    const error = isControlled ? controlledError ?? null : localError;
    const queueId = isControlled ? controlledQueueId : localQueueId;
    useEffect(() => {
        if (isControlled || !riotAccountId)
            return;
        let alive = true;
        setLocalRows(null);
        setLocalError(null);
        void fetchMatchHistory(riotAccountId, { limit: 50, queueId })
            .then((r) => alive && setLocalRows(r))
            .catch((e) => alive && setLocalError(e?.message ?? "Failed to load matches"));
        return () => {
            alive = false;
        };
    }, [isControlled, riotAccountId, queueId]);
    if (!riotAccountId) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: "No account linked", hint: "Open the League client and sign in \u2014 LOBLY links your account automatically." }) }));
    }
    const agg = rows?.length ? aggregate(rows) : null;
    const sampleCount = fetchedCount ?? rows?.length ?? 0;
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs(Card, { pad: 10, style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    background: c.surfaceAlt,
                }, children: [MATCH_QUEUE_FILTERS.map((f) => {
                        const active = f.queueId === queueId;
                        return (_jsx("button", { type: "button", "aria-pressed": active, onClick: () => {
                                setExpanded(null);
                                if (isControlled)
                                    onQueueChange?.(f.queueId);
                                else
                                    setLocalQueueId(f.queueId);
                            }, style: {
                                background: active ? c.primarySoft : "transparent",
                                color: active ? c.text : c.textDim,
                                border: `1px solid ${active ? c.primary : c.border}`,
                                borderRadius: radius.pill,
                                padding: "5px 14px",
                                fontSize: 12,
                                fontWeight: 600,
                            }, children: f.label }, f.label));
                    }), _jsx("span", { style: { color: c.textFaint, fontSize: 10 }, children: rows ? `${rows.length} shown from ${sampleCount} fetched` : `Up to ${sampleCount || 50} recent` }), agg && (_jsxs("div", { style: {
                            marginLeft: "auto",
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            fontSize: 12,
                            color: c.textDim,
                        }, children: [_jsxs("span", { children: [_jsxs("strong", { style: { color: c.win }, children: [agg.wins, "W"] }), " ", _jsxs("strong", { style: { color: c.loss }, children: [agg.losses, "L"] })] }), _jsxs("span", { children: ["WR ", _jsxs("strong", { style: { color: c.text }, children: [agg.winRate, "%"] })] }), _jsxs("span", { children: ["KDA", " ", _jsx("strong", { style: { color: kdaColor(agg.kda) }, children: agg.kda == null ? "Perfect" : agg.kda })] })] }))] }), rows === null && !error && _jsx(Card, { children: _jsx(LoadingBlock, { label: "Loading matches" }) }), error && (_jsx(Card, { children: _jsx(EmptyState, { title: "Couldn't load matches", hint: error }) })), rows?.length === 0 && (_jsx(Card, { children: _jsx(EmptyState, { title: queueId == null
                        ? "No matches yet"
                        : `No ${matchQueueLabel(queueId)} matches in this sample`, hint: queueId == null
                        ? "Play a game and LOBLY will pull it in automatically after it ends."
                        : `Try another queue. Filters use the latest ${sampleCount} fetched matches without making another request.` }) })), rows?.map((m) => (_jsx(MatchRow, { m: m, sd: sd, expanded: expanded === m.matchId, onToggle: () => setExpanded(expanded === m.matchId ? null : m.matchId) }, m.matchId)))] }));
}
/* -------------------------------------------------------------- one match */
function MatchRow({ m, sd, expanded, onToggle, }) {
    const accent = m.win ? c.win : c.loss;
    const champName = championDisplayName(sd, m.championId, m.championName);
    return (_jsxs("div", { className: "lobly-fade", style: {
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderLeft: `3px solid ${accent}`,
            borderRadius: radius.lg,
            overflow: "hidden",
        }, children: [_jsxs("div", { onClick: onToggle, onKeyDown: (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onToggle();
                    }
                }, role: "button", tabIndex: 0, "aria-expanded": expanded, "aria-label": `${m.win ? "Victory" : "Defeat"} as ${champName}, ${m.kills} kills, ${m.deaths} deaths, ${m.assists} assists`, className: "lobly-row", style: {
                    display: "grid",
                    gridTemplateColumns: "96px 56px minmax(150px, 1fr) auto 92px",
                    gap: 14,
                    alignItems: "center",
                    padding: "12px 14px",
                    cursor: "pointer",
                    background: m.win ? `${c.win}08` : `${c.loss}08`,
                }, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: { color: accent, fontWeight: 700, fontSize: 13 }, children: m.win ? "Victory" : "Defeat" }), _jsx("div", { style: { color: c.textDim, fontSize: 11, marginTop: 2 }, children: queueName(m.queueId) }), _jsxs("div", { style: { color: c.textFaint, fontSize: 11, marginTop: 1 }, children: [timeAgo(m.gameCreation), " \u00B7 ", formatDuration(m.gameDuration)] })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [_jsxs("div", { style: { position: "relative" }, children: [_jsx(Avatar, { url: championIcon(sd, m.championId), size: 44, alt: champName }), m.champLevel != null && (_jsx("span", { style: {
                                            position: "absolute",
                                            bottom: -3,
                                            right: -3,
                                            background: c.bg,
                                            border: `1px solid ${c.borderStrong}`,
                                            borderRadius: "50%",
                                            width: 18,
                                            height: 18,
                                            fontSize: 10,
                                            fontWeight: 700,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: c.textDim,
                                        }, children: m.champLevel }))] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [_jsx(MiniIcon, { url: spellIcon(sd, m.summoner1Id) }), _jsx(MiniIcon, { url: spellIcon(sd, m.summoner2Id) })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [_jsx(MiniIcon, { url: runeIcon(sd, m.primaryRune), round: true }), _jsx(MiniIcon, { url: runeIcon(sd, m.subStyle), round: true })] })] }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsxs("div", { style: {
                                    fontFamily: font.mono,
                                    fontSize: 15,
                                    fontWeight: 700,
                                    letterSpacing: 0.3,
                                }, children: [m.kills, _jsx("span", { style: { color: c.textFaint }, children: " / " }), _jsx("span", { style: { color: c.loss }, children: m.deaths }), _jsx("span", { style: { color: c.textFaint }, children: " / " }), m.assists] }), _jsxs("div", { style: { fontSize: 11, color: c.textDim, marginTop: 2 }, children: [_jsx("span", { style: { color: kdaColor(m.kda), fontWeight: 700 }, children: m.kda == null ? "Perfect" : `${m.kda.toFixed(2)}` }), " ", "KDA", m.killParticipation != null && ` · ${m.killParticipation}% KP`] }), _jsxs("div", { style: { fontSize: 11, color: c.textFaint, marginTop: 1 }, children: [m.cs, " CS (", m.csPerMin.toFixed(1), "/m) \u00B7 ", (m.gold / 1000).toFixed(1), "k gold", m.visionScore > 0 && ` · ${m.visionScore} vision`] })] }), _jsxs("div", { style: { display: "flex", gap: 3, alignItems: "center" }, children: [m.items.slice(0, 6).map((id, i) => (_jsx(ItemSlot, { url: itemIcon(sd, id) }, i))), _jsx("div", { style: { width: 6 } }), _jsx(ItemSlot, { url: itemIcon(sd, m.items[6] ?? 0), round: true })] }), _jsxs("div", { style: {
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 4,
                            minWidth: 92,
                        }, children: [m.multikill >= 2 && (_jsx(Tag, { color: c.warn, children: MULTIKILL_LABEL[m.multikill] ?? "Multikill" })), m.damageShare != null && m.damageShare >= 30 && (_jsxs(Tag, { color: c.accent, children: [m.damageShare, "% DMG"] })), m.teamPosition && (_jsx("span", { style: { color: c.textFaint, display: "flex", gap: 4, fontSize: 11 }, children: _jsx(RoleIcon, { role: m.teamPosition, size: 13, color: c.textFaint }) })), _jsx("span", { style: { color: c.textFaint, fontSize: 16, lineHeight: 1 }, children: expanded ? "⌃" : "⌄" })] })] }), expanded && _jsx(Scoreboard, { m: m, sd: sd })] }));
}
/* ------------------------------------------------------------ scoreboard */
function Scoreboard({ m, sd }) {
    const maxDamage = Math.max(1, ...[...m.teammates, ...m.opponents].map((p) => p.damageDealt));
    return (_jsxs("div", { className: "lobly-fade", style: {
            borderTop: `1px solid ${c.border}`,
            background: c.bg,
            padding: 12,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
        }, children: [_jsx(TeamColumn, { title: m.win ? "Victory" : "Defeat", color: m.win ? c.win : c.loss, players: m.teammates, sd: sd, maxDamage: maxDamage }), _jsx(TeamColumn, { title: m.win ? "Defeat" : "Victory", color: m.win ? c.loss : c.win, players: m.opponents, sd: sd, maxDamage: maxDamage })] }));
}
function TeamColumn({ title, color, players, sd, maxDamage, }) {
    return (_jsxs("div", { children: [_jsx("div", { style: {
                    fontSize: 11,
                    fontWeight: 700,
                    color,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    marginBottom: 6,
                }, children: title }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: players.map((p) => (_jsxs("div", { style: {
                        display: "grid",
                        gridTemplateColumns: "24px 1fr 62px 46px",
                        gap: 8,
                        alignItems: "center",
                        padding: "4px 6px",
                        borderRadius: radius.sm,
                        background: p.isMe ? c.primarySoft : "transparent",
                        fontSize: 11,
                    }, children: [_jsx(Avatar, { url: championIcon(sd, p.championId), size: 24 }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        color: p.isMe ? c.text : c.textDim,
                                        fontWeight: p.isMe ? 700 : 500,
                                    }, children: p.riotId }), _jsx("div", { style: { height: 3, marginTop: 3, background: c.surfaceAlt, borderRadius: 2 }, children: _jsx("div", { style: {
                                            width: `${(p.damageDealt / maxDamage) * 100}%`,
                                            height: "100%",
                                            background: p.isMe ? c.primary : c.borderStrong,
                                            borderRadius: 2,
                                        } }) })] }), _jsxs("div", { style: { fontFamily: font.mono, color: c.textDim, textAlign: "right" }, children: [p.kills, "/", p.deaths, "/", p.assists] }), _jsxs("div", { style: { color: c.textFaint, textAlign: "right" }, children: [p.cs, " cs"] })] }, p.puuid))) })] }));
}
/* ----------------------------------------------------------------- atoms */
function MiniIcon({ url, round }) {
    return (_jsx("div", { style: {
            width: 20,
            height: 20,
            borderRadius: round ? "50%" : radius.sm,
            background: c.surfaceAlt,
            overflow: "hidden",
            border: `1px solid ${c.border}`,
        }, children: url && _jsx("img", { src: url, width: 20, height: 20, alt: "", style: { display: "block" } }) }));
}
function ItemSlot({ url, round }) {
    return (_jsx("div", { style: {
            width: 26,
            height: 26,
            borderRadius: round ? "50%" : radius.sm,
            background: c.surfaceAlt,
            border: `1px solid ${c.border}`,
            overflow: "hidden",
        }, children: url && _jsx("img", { src: url, width: 26, height: 26, alt: "", style: { display: "block" } }) }));
}
/* ----------------------------------------------------------------- utils */
const MULTIKILL_LABEL = {
    2: "Double Kill",
    3: "Triple Kill",
    4: "Quadra Kill",
    5: "PENTAKILL",
};
export function kdaColor(kda) {
    if (kda == null)
        return c.gold;
    if (kda >= 5)
        return c.gold;
    if (kda >= 3)
        return c.accent;
    if (kda >= 2)
        return c.text;
    return c.textDim;
}
export function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}
export function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60)
        return `${Math.max(mins, 1)}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30)
        return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}
function aggregate(rows) {
    const wins = rows.filter((r) => r.win).length;
    const losses = rows.length - wins;
    const k = rows.reduce((s, r) => s + r.kills, 0);
    const d = rows.reduce((s, r) => s + r.deaths, 0);
    const a = rows.reduce((s, r) => s + r.assists, 0);
    return {
        wins,
        losses,
        winRate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
        kda: d === 0 ? null : Number(((k + a) / d).toFixed(2)),
    };
}
