import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo } from "react";
import { c, font, radius } from "./theme";
import { Avatar, Button, Card, EmptyState, LoadingBlock, RoleIcon, SectionTitle, Tag, } from "./components";
import { championDisplayName, championIcon, useStaticData } from "./useStaticData";
export function ProfileAnalytics({ rows, error, queueLabel, fetchedCount, onRetry, }) {
    const sd = useStaticData();
    const analytics = useMemo(() => (rows?.length ? buildAnalytics(rows) : null), [rows]);
    if (rows === null && !error) {
        return (_jsx(Card, { children: _jsx(LoadingBlock, { label: "Building recent-match analytics" }) }));
    }
    if (error) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: "Analytics are temporarily unavailable", hint: `LOBLY couldn't load your recent matches: ${error}`, action: onRetry ? (_jsx(Button, { variant: "ghost", onClick: onRetry, children: "Try again" })) : undefined }) }));
    }
    if (!rows?.length || !analytics) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: `No ${queueLabel.toLowerCase()} matches in this sample`, hint: fetchedCount
                    ? `Try another queue. This view is filtered from your latest ${fetchedCount} fetched matches.`
                    : "Play a game and LOBLY will build this view after the match is imported." }) }));
    }
    const { summary, champions, roles, currentStreak, trend, comparison } = analytics;
    const sampleLabel = queueLabel === "All queues"
        ? `Last ${summary.games} matches`
        : `${summary.games} ${queueLabel} matches within latest ${fetchedCount}`;
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs(Card, { style: {
                    background: `linear-gradient(135deg, ${c.primarySoft}, ${c.surface} 45%)`,
                    overflow: "hidden",
                }, children: [_jsx(SectionTitle, { right: _jsx(Tag, { color: c.accent, children: sampleLabel }), children: "Recent performance" }), _jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))",
                            gap: 8,
                        }, children: [_jsx(Metric, { label: "Win rate", value: `${summary.winRate.toFixed(0)}%`, detail: `${summary.wins}W · ${summary.games - summary.wins}L`, color: summary.winRate >= 50 ? c.win : c.loss }), _jsx(Metric, { label: "KDA", value: formatKda(summary.kda), detail: `${summary.kills.toFixed(1)} / ${summary.deaths.toFixed(1)} / ${summary.assists.toFixed(1)} avg`, color: kdaTone(summary.kda) }), _jsx(Metric, { label: "Kill participation", value: formatNullable(summary.killParticipation, "%"), detail: "average when available" }), _jsx(Metric, { label: "CS / min", value: summary.csPerMin.toFixed(1), detail: "average pace" }), _jsx(Metric, { label: "Gold / min", value: Math.round(summary.goldPerMin).toLocaleString(), detail: "average income", color: c.gold }), _jsx(Metric, { label: "Damage / min", value: Math.round(summary.damagePerMin).toLocaleString(), detail: "to champions", color: c.accent }), _jsx(Metric, { label: "Team damage", value: formatNullable(summary.damageShare, "%"), detail: "average share" }), _jsx(Metric, { label: "Vision / min", value: summary.visionPerMin.toFixed(2), detail: "average pace" })] })] }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    gap: 12,
                }, children: [_jsx(TrendCard, { rows: rows, trend: trend, currentStreak: currentStreak }), _jsx(PlaystyleCard, { summary: summary, roles: roles })] }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    gap: 12,
                }, children: [_jsx(ChampionCard, { champions: champions, sd: sd }), _jsx(ComparisonCard, { comparison: comparison })] })] }));
}
function Metric({ label, value, detail, color, }) {
    return (_jsxs("div", { style: {
            minHeight: 88,
            padding: "12px 13px",
            background: `${c.bg}99`,
            border: `1px solid ${c.border}`,
            borderRadius: radius.md,
        }, children: [_jsx("div", { style: {
                    color: c.textFaint,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.7,
                    textTransform: "uppercase",
                }, children: label }), _jsx("div", { style: {
                    marginTop: 5,
                    color: color ?? c.text,
                    fontFamily: font.mono,
                    fontSize: 20,
                    fontWeight: 750,
                }, children: value }), _jsx("div", { style: { marginTop: 3, color: c.textDim, fontSize: 10 }, children: detail })] }));
}
function TrendCard({ rows, trend, currentStreak, }) {
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { right: currentStreak !== 0 ? (_jsxs(Tag, { color: currentStreak > 0 ? c.win : c.loss, children: [Math.abs(currentStreak), " ", currentStreak > 0 ? "win" : "loss", " streak"] })) : undefined, children: "Form trend" }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: [_jsx(TrendLine, { label: "Rolling 5-game WR", values: trend.winRate, color: c.primary, domain: [0, 100], value: `${trend.winRate.at(-1)?.toFixed(0) ?? "—"}%` }), _jsx(TrendLine, { label: "Rolling 5-game KDA", values: trend.kda, color: c.accent, value: formatKda(trend.kda.at(-1) ?? null) }), _jsx("div", { style: { display: "flex", gap: 3 }, "aria-label": "Match results, oldest to newest", children: [...rows].reverse().map((row) => (_jsx("span", { title: `${row.win ? "Win" : "Loss"} · ${row.kills}/${row.deaths}/${row.assists}`, style: {
                                height: 5,
                                flex: 1,
                                minWidth: 2,
                                borderRadius: radius.pill,
                                background: row.win ? c.win : c.loss,
                                opacity: 0.85,
                            } }, row.matchId))) }), _jsx("div", { style: { color: c.textFaint, fontSize: 10 }, children: "Oldest \u2192 newest \u00B7 each point aggregates up to five games" })] })] }));
}
function TrendLine({ label, values, color, domain, value, }) {
    const width = 300;
    const height = 56;
    const points = values
        .map((entry, index) => ({ entry, index }))
        .filter((point) => point.entry != null);
    const observed = points.map((point) => point.entry);
    const min = domain?.[0] ?? Math.min(...observed);
    const max = domain?.[1] ?? Math.max(...observed);
    const span = Math.max(max - min, 0.5);
    const path = points
        .map(({ entry, index }, pointIndex) => {
        const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
        const y = height - 4 - ((entry - min) / span) * (height - 8);
        const previousIndex = pointIndex ? points[pointIndex - 1].index : -2;
        return `${previousIndex === index - 1 ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
        .join(" ");
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" }, children: [_jsx("span", { style: { color: c.textDim, fontSize: 11 }, children: label }), _jsx("span", { style: { color, fontFamily: font.mono, fontWeight: 700 }, children: value })] }), _jsxs("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: height, preserveAspectRatio: "none", role: "img", "aria-label": `${label} trend`, style: { display: "block", marginTop: 4 }, children: [_jsx("line", { x1: "0", y1: height / 2, x2: width, y2: height / 2, stroke: c.border }), _jsx("path", { d: path, fill: "none", stroke: color, strokeWidth: "2.5", vectorEffect: "non-scaling-stroke" })] })] }));
}
function PlaystyleCard({ summary, roles, }) {
    const axes = [
        { label: "KP", value: summary.killParticipation ?? 0, max: 100 },
        { label: "CS/m", value: summary.csPerMin, max: 12 },
        { label: "DMG", value: summary.damageShare ?? 0, max: 100 },
        { label: "Vision", value: summary.visionPerMin, max: 3 },
    ];
    const center = 66;
    const maxRadius = 42;
    const points = axes
        .map((axis, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
        const scale = Math.min(Math.max(axis.value / axis.max, 0), 1);
        return `${center + Math.cos(angle) * maxRadius * scale},${center + Math.sin(angle) * maxRadius * scale}`;
    })
        .join(" ");
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Playstyle footprint" }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "150px minmax(120px, 1fr)",
                    gap: 14,
                    alignItems: "center",
                }, children: [_jsxs("svg", { viewBox: "0 0 132 132", width: 150, height: 150, role: "img", "aria-label": "Absolute recent playstyle rates", children: [[0.33, 0.66, 1].map((scale) => (_jsx("polygon", { points: axes
                                    .map((_, index) => {
                                    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
                                    return `${center + Math.cos(angle) * maxRadius * scale},${center + Math.sin(angle) * maxRadius * scale}`;
                                })
                                    .join(" "), fill: "none", stroke: c.border }, scale))), axes.map((axis, index) => {
                                const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
                                const x = center + Math.cos(angle) * maxRadius;
                                const y = center + Math.sin(angle) * maxRadius;
                                const labelX = center + Math.cos(angle) * 57;
                                const labelY = center + Math.sin(angle) * 57 + 3;
                                return (_jsxs("g", { children: [_jsx("line", { x1: center, y1: center, x2: x, y2: y, stroke: c.border }), _jsx("text", { x: labelX, y: labelY, fill: c.textDim, fontSize: "8", textAnchor: "middle", fontFamily: font.sans, children: axis.label })] }, axis.label));
                            }), _jsx("polygon", { points: points, fill: c.primarySoft, stroke: c.primary, strokeWidth: "2", strokeLinejoin: "round" })] }), _jsxs("div", { children: [_jsx("div", { style: { color: c.textDim, fontSize: 11, marginBottom: 8 }, children: "Role distribution" }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 7 }, children: roles.slice(0, 5).map((role) => (_jsxs("div", { children: [_jsxs("div", { style: {
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: 8,
                                                color: c.textDim,
                                                fontSize: 11,
                                            }, children: [_jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 5 }, children: [_jsx(RoleIcon, { role: role.role, size: 12 }), roleLabel(role.role)] }), _jsxs("span", { style: { fontFamily: font.mono }, children: [role.percentage.toFixed(0), "%"] })] }), _jsx("div", { style: {
                                                height: 3,
                                                marginTop: 3,
                                                borderRadius: radius.pill,
                                                background: c.surfaceAlt,
                                            }, children: _jsx("div", { style: {
                                                    width: `${role.percentage}%`,
                                                    height: "100%",
                                                    borderRadius: radius.pill,
                                                    background: c.accent,
                                                } }) })] }, role.role))) })] })] }), _jsx("div", { style: { color: c.textFaint, fontSize: 10, lineHeight: 1.5 }, children: "Absolute rates, not percentiles. Radar limits: 100% KP, 12 CS/min, 100% team damage, 3 vision/min." })] }));
}
function ChampionCard({ champions, sd, }) {
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Champion performance" }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 9 }, children: champions.slice(0, 5).map((champion) => {
                    const winRate = (champion.wins / champion.games) * 100;
                    const kda = champion.deaths === 0
                        ? null
                        : (champion.kills + champion.assists) / champion.deaths;
                    return (_jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "34px minmax(90px, 1fr) auto",
                            gap: 9,
                            alignItems: "center",
                            padding: "5px 0",
                        }, children: [_jsx(Avatar, { url: championIcon(sd, champion.championId), size: 34, alt: championDisplayName(sd, champion.championId, champion.championName) }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            fontWeight: 650,
                                        }, children: championDisplayName(sd, champion.championId, champion.championName) }), _jsxs("div", { style: { color: c.textDim, fontSize: 10, marginTop: 2 }, children: [champion.wins, "W \u00B7 ", champion.games - champion.wins, "L \u00B7 ", formatKda(kda), " KDA"] })] }), _jsxs("div", { style: { textAlign: "right" }, children: [_jsxs("div", { style: {
                                            color: winRate >= 50 ? c.win : c.loss,
                                            fontFamily: font.mono,
                                            fontWeight: 700,
                                        }, children: [winRate.toFixed(0), "%"] }), _jsxs("div", { style: { color: champion.streak > 0 ? c.win : c.loss, fontSize: 10 }, children: [Math.abs(champion.streak), " ", champion.streak > 0 ? "W" : "L", " streak"] })] })] }, champion.championId));
                }) })] }));
}
function ComparisonCard({ comparison, }) {
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { right: _jsxs("span", { style: { color: c.textFaint, fontSize: 10 }, children: [comparison.recentCount, "/5 vs ", comparison.priorCount, "/5 games"] }), children: "Recent five vs prior five" }), comparison.priorCount === 0 ? (_jsx(EmptyState, { title: "More matches needed", hint: "At least six matching games are needed to compare your two recent windows." })) : (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(110px, 1fr))",
                            gap: 8,
                        }, children: comparison.deltas.map((delta) => {
                            const tone = delta.value == null || Math.abs(delta.value) < 0.005
                                ? c.textDim
                                : delta.value > 0
                                    ? c.win
                                    : c.loss;
                            return (_jsxs("div", { style: {
                                    padding: 11,
                                    borderRadius: radius.md,
                                    background: c.surfaceAlt,
                                    border: `1px solid ${c.border}`,
                                }, children: [_jsx("div", { style: { color: c.textFaint, fontSize: 10 }, children: delta.label }), _jsx("div", { style: {
                                            marginTop: 5,
                                            color: tone,
                                            fontFamily: font.mono,
                                            fontSize: 17,
                                            fontWeight: 700,
                                        }, children: formatDelta(delta.value, delta.suffix, delta.digits) })] }, delta.label));
                        }) }), (comparison.recentCount < 5 || comparison.priorCount < 5) && (_jsx("div", { style: { color: c.textFaint, fontSize: 10, marginTop: 10 }, children: "Partial windows are shown because fewer than ten matching games were available." }))] }))] }));
}
function buildAnalytics(rows) {
    const summary = summarize(rows);
    const championMap = new Map();
    const roleMap = new Map();
    for (const row of rows) {
        const championRows = championMap.get(row.championId) ?? [];
        championRows.push(row);
        championMap.set(row.championId, championRows);
        const role = row.teamPosition || "UNKNOWN";
        roleMap.set(role, (roleMap.get(role) ?? 0) + 1);
    }
    const champions = [...championMap.entries()]
        .map(([championId, championRows]) => {
        const totals = sumCombat(championRows);
        return {
            championId,
            championName: championRows[0].championName,
            games: championRows.length,
            wins: championRows.filter((row) => row.win).length,
            kills: totals.kills,
            deaths: totals.deaths,
            assists: totals.assists,
            streak: resultStreak(championRows),
        };
    })
        .sort((a, b) => b.games - a.games || b.wins / b.games - a.wins / a.games);
    const roles = [...roleMap.entries()]
        .map(([role, games]) => ({ role, games, percentage: (games / rows.length) * 100 }))
        .sort((a, b) => b.games - a.games);
    const chronological = [...rows].reverse();
    const trend = {
        winRate: chronological.map((_, index) => {
            const window = chronological.slice(Math.max(0, index - 4), index + 1);
            return summarize(window).winRate;
        }),
        kda: chronological.map((_, index) => {
            const window = chronological.slice(Math.max(0, index - 4), index + 1);
            return summarize(window).kda;
        }),
    };
    const recent = rows.slice(0, 5);
    const prior = rows.slice(5, 10);
    const recentSummary = summarize(recent);
    const priorSummary = prior.length ? summarize(prior) : null;
    const comparison = {
        recentCount: recent.length,
        priorCount: prior.length,
        deltas: [
            {
                label: "Win rate",
                value: priorSummary ? recentSummary.winRate - priorSummary.winRate : null,
                suffix: " pp",
                digits: 0,
            },
            {
                label: "KDA",
                value: priorSummary?.kda != null && recentSummary.kda != null
                    ? recentSummary.kda - priorSummary.kda
                    : null,
                suffix: "",
                digits: 2,
            },
            {
                label: "Kill participation",
                value: priorSummary?.killParticipation != null && recentSummary.killParticipation != null
                    ? recentSummary.killParticipation - priorSummary.killParticipation
                    : null,
                suffix: " pp",
                digits: 0,
            },
            {
                label: "CS / min",
                value: priorSummary ? recentSummary.csPerMin - priorSummary.csPerMin : null,
                suffix: "",
                digits: 1,
            },
        ],
    };
    return { summary, champions, roles, currentStreak: resultStreak(rows), trend, comparison };
}
function summarize(rows) {
    if (!rows.length) {
        return {
            games: 0,
            wins: 0,
            winRate: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            kda: null,
            killParticipation: null,
            csPerMin: 0,
            goldPerMin: 0,
            damagePerMin: 0,
            damageShare: null,
            visionPerMin: 0,
        };
    }
    const totals = sumCombat(rows);
    const killParticipation = averageDefined(rows.map((row) => row.killParticipation));
    const damageShare = averageDefined(rows.map((row) => row.damageShare));
    const perMinute = rows.map((row) => {
        const minutes = Math.max(row.gameDuration / 60, 1 / 60);
        return {
            gold: row.gold / minutes,
            damage: row.damageDealt / minutes,
            vision: row.visionScore / minutes,
        };
    });
    return {
        games: rows.length,
        wins: rows.filter((row) => row.win).length,
        winRate: (rows.filter((row) => row.win).length / rows.length) * 100,
        kills: totals.kills / rows.length,
        deaths: totals.deaths / rows.length,
        assists: totals.assists / rows.length,
        kda: totals.deaths === 0 ? null : (totals.kills + totals.assists) / totals.deaths,
        killParticipation,
        csPerMin: average(rows.map((row) => row.csPerMin)),
        goldPerMin: average(perMinute.map((row) => row.gold)),
        damagePerMin: average(perMinute.map((row) => row.damage)),
        damageShare,
        visionPerMin: average(perMinute.map((row) => row.vision)),
    };
}
function sumCombat(rows) {
    return rows.reduce((total, row) => ({
        kills: total.kills + row.kills,
        deaths: total.deaths + row.deaths,
        assists: total.assists + row.assists,
    }), { kills: 0, deaths: 0, assists: 0 });
}
function resultStreak(rows) {
    if (!rows.length)
        return 0;
    const firstResult = rows[0].win;
    let count = 0;
    for (const row of rows) {
        if (row.win !== firstResult)
            break;
        count += 1;
    }
    return firstResult ? count : -count;
}
function average(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}
function averageDefined(values) {
    const defined = values.filter((value) => value != null);
    return defined.length ? average(defined) : null;
}
function formatNullable(value, suffix = "") {
    return value == null ? "—" : `${value.toFixed(0)}${suffix}`;
}
function formatKda(value) {
    return value == null ? "Perfect" : value.toFixed(2);
}
function formatDelta(value, suffix, digits) {
    if (value == null)
        return "—";
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(digits)}${suffix}`;
}
function kdaTone(kda) {
    if (kda == null || kda >= 5)
        return c.gold;
    if (kda >= 3)
        return c.accent;
    return c.text;
}
function roleLabel(role) {
    return ({
        TOP: "Top",
        JUNGLE: "Jungle",
        MIDDLE: "Mid",
        BOTTOM: "Bot",
        UTILITY: "Support",
        UNKNOWN: "Unassigned",
    }[role] ?? role);
}
