import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { fetchMatchHistory, fetchMyProfiles } from "../api/session";
import { getBridge } from "../shared/bridge";
import { useAppStore } from "../shared/messaging";
import { c, radius, font, tierColor } from "./theme";
import { Avatar, Button, Card, EmptyState, LoadingBlock, RankBadge, RoleLabel, SectionTitle, StatBlock, Tag, WinRateBar, titleCase, } from "./components";
import { MatchHistory, kdaColor, matchQueueLabel } from "./MatchHistory";
import { ProfileAnalytics } from "./ProfileAnalytics";
import { championDisplayName, championIcon, profileIcon, useStaticData, } from "./useStaticData";
export function ProfileView() {
    const sd = useStaticData();
    const state = useAppStore();
    const [cards, setCards] = useState(null);
    const [error, setError] = useState(null);
    const [matches, setMatches] = useState(null);
    const [matchesError, setMatchesError] = useState(null);
    const [queueId, setQueueId] = useState(undefined);
    const [profileRequest, setProfileRequest] = useState(0);
    const [matchRequest, setMatchRequest] = useState(0);
    // A LOBLY user can have multiple linked Riot accounts (smurfs) — always
    // show the one that's actually logged into the League client right now,
    // never just whichever happened to be linked first.
    const activeAccountId = state.riotAccountId;
    useEffect(() => {
        let alive = true;
        setCards(null);
        setError(null);
        void fetchMyProfiles()
            .then((r) => {
            if (!alive)
                return;
            setCards(r);
            const card = r.find((x) => x.account.id === activeAccountId) ?? r[0];
            if (card?.snapshot) {
                getBridge()?.store.update({
                    profileHints: {
                        soloTier: card.snapshot.solo?.tier ?? null,
                        soloDivision: card.snapshot.solo?.division ?? null,
                        flexTier: card.snapshot.flex?.tier ?? null,
                        flexDivision: card.snapshot.flex?.division ?? null,
                        primaryRole: card.snapshot.primaryRole,
                        secondaryRole: card.snapshot.secondaryRole,
                        languages: card.prefs?.languages,
                    },
                });
            }
        })
            .catch((e) => alive && setError(e?.message ?? "Failed to load profile"));
        return () => {
            alive = false;
        };
    }, [profileRequest, activeAccountId]);
    const activeCard = useMemo(() => cards?.find((x) => x.account.id === activeAccountId) ?? cards?.[0], [cards, activeAccountId]);
    const accountId = activeCard?.account.id;
    useEffect(() => {
        if (!accountId)
            return;
        let alive = true;
        setMatches(null);
        setMatchesError(null);
        void fetchMatchHistory(accountId, { limit: 50 })
            .then((rows) => alive && setMatches(rows))
            .catch((e) => alive && setMatchesError(e?.message ?? "Failed to load recent matches"));
        return () => {
            alive = false;
        };
    }, [accountId, matchRequest]);
    const filteredMatches = useMemo(() => (matches && queueId != null ? matches.filter((row) => row.queueId === queueId) : matches), [matches, queueId]);
    if (error) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: "Couldn't load your profile", hint: error, action: _jsx(Button, { variant: "ghost", onClick: () => setProfileRequest((request) => request + 1), children: "Try again" }) }) }));
    }
    if (!cards)
        return _jsx(Card, { children: _jsx(LoadingBlock, { label: "Loading profile" }) });
    if (!cards.length) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: "No Riot account linked yet", hint: "Sign in to the League client while LOBLY is running \u2014 your account links automatically, no password needed." }) }));
    }
    const card = activeCard ?? cards[0];
    const snap = card.snapshot;
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsx(Card, { pad: 0, style: {
                    overflow: "hidden",
                    borderRadius: radius.xl,
                    background: c.surface,
                }, children: _jsxs("div", { style: {
                        background: `
              radial-gradient(circle at 12% 10%, ${c.primarySoft}, transparent 34%),
              linear-gradient(120deg, ${c.surfaceAlt}, ${c.surface} 58%)
            `,
                        padding: 24,
                        display: "flex",
                        gap: 20,
                        alignItems: "center",
                        flexWrap: "wrap",
                    }, children: [_jsx(Avatar, { url: profileIcon(sd, snap?.profileIconId), size: 84, ring: tierColor(snap?.solo.tier) }), _jsxs("div", { style: { minWidth: 200 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [_jsx("span", { style: { fontSize: 26, fontWeight: 750, letterSpacing: -0.5 }, children: card.account.riotId }), _jsxs("span", { style: { fontSize: 15, color: c.textDim }, children: ["#", card.account.tagLine] })] }), _jsxs("div", { style: {
                                        display: "flex",
                                        gap: 8,
                                        marginTop: 8,
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                    }, children: [_jsx(Tag, { color: c.textDim, children: card.account.platform.toUpperCase() }), snap?.summonerLevel != null && (_jsxs(Tag, { color: c.textDim, children: ["Level ", snap.summonerLevel] })), snap?.primaryRole && (_jsx(Tag, { color: c.accent, children: _jsx(RoleLabel, { role: snap.primaryRole }) })), card.reputation?.provisional && _jsx(Tag, { color: c.warn, children: "Provisional" }), card.account.verifiedAt && _jsx(Tag, { color: c.win, children: "\u2713 Verified" })] })] }), _jsxs("div", { style: {
                                display: "flex",
                                gap: 28,
                                marginLeft: "auto",
                                flexWrap: "wrap",
                                padding: "13px 16px",
                                background: `${c.bg}99`,
                                border: `1px solid ${c.border}`,
                                borderRadius: radius.lg,
                            }, children: [_jsx(StatBlock, { label: "Form (20g)", value: snap?.formWr20 != null ? `${snap.formWr20}%` : "—", color: snap?.formWr20 == null
                                        ? c.textDim
                                        : snap.formWr20 >= 50
                                            ? c.win
                                            : c.loss, sub: "win rate" }), _jsx(StatBlock, { label: "Streak", value: snap?.streak
                                        ? `${snap.streak > 0 ? "+" : ""}${snap.streak}`
                                        : "—", color: !snap?.streak ? c.textDim : snap.streak > 0 ? c.win : c.loss, sub: snap?.streak ? (snap.streak > 0 ? "wins" : "losses") : undefined }), _jsx(StatBlock, { label: "Reliability", value: card.reputation?.reliability ?? "New", color: c.primary, sub: "LOBLY score" })] })] }) }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 16,
                }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Ranked" }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: [_jsx(QueueRank, { label: "Solo / Duo", rank: snap?.solo }), _jsx(QueueRank, { label: "Flex 5v5", rank: snap?.flex })] }), snap && (_jsxs("div", { style: {
                                    marginTop: 14,
                                    paddingTop: 12,
                                    borderTop: `1px solid ${c.border}`,
                                    display: "flex",
                                    gap: 24,
                                }, children: [_jsx(StatBlock, { label: "Primary", value: _jsx(RoleLabel, { role: snap.primaryRole }) }), _jsx(StatBlock, { label: "Secondary", value: _jsx(RoleLabel, { role: snap.secondaryRole }) }), _jsx(StatBlock, { label: "Games", value: snap.gamesThisSeason ?? 0, sub: "ranked" })] }))] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Top champions" }), !card.champions.length && (_jsx("div", { style: { color: c.textFaint, padding: "12px 0" }, children: "No champion data yet." })), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: card.champions.slice(0, 6).map((ch) => {
                                    const wr = ch.games ? Math.round((ch.wins / ch.games) * 100) : 0;
                                    return (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx(Avatar, { url: championIcon(sd, ch.championId), size: 32 }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: {
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            gap: 8,
                                                        }, children: [_jsx("span", { style: { fontWeight: 600 }, children: championDisplayName(sd, ch.championId, ch.name) }), _jsxs("span", { style: {
                                                                    fontFamily: font.mono,
                                                                    fontSize: 12,
                                                                    color: kdaColor(ch.kda),
                                                                    fontWeight: 700,
                                                                }, children: [Number(ch.kda).toFixed(2), " KDA"] })] }), _jsxs("div", { style: {
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 8,
                                                            marginTop: 3,
                                                        }, children: [_jsx("div", { style: { flex: 1 }, children: _jsx(WinRateBar, { wins: ch.wins, losses: ch.games - ch.wins, height: 4 }) }), _jsxs("span", { style: { fontSize: 11, color: c.textDim, minWidth: 74 }, children: [wr, "% \u00B7 ", ch.games, "g"] })] })] })] }, ch.championId));
                                }) })] })] }), _jsxs("div", { children: [_jsx(SectionTitle, { children: "Performance analytics" }), _jsx(ProfileAnalytics, { rows: filteredMatches, error: matchesError, queueLabel: matchQueueLabel(queueId), fetchedCount: matches?.length ?? 0, onRetry: () => setMatchRequest((request) => request + 1) })] }), _jsxs("div", { children: [_jsx(SectionTitle, { children: "Match history" }), _jsx(MatchHistory, { riotAccountId: card.account.id, rows: filteredMatches, error: matchesError, queueId: queueId, onQueueChange: setQueueId, fetchedCount: matches?.length ?? 0 })] }), _jsx(PrefsCard, { card: card })] }));
}
function QueueRank({ label, rank, }) {
    const wins = rank?.wins ?? 0;
    const losses = rank?.losses ?? 0;
    const total = wins + losses;
    const wr = total ? Math.round((wins / total) * 100) : 0;
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" }, children: [_jsx("span", { style: { color: c.textDim, fontSize: 12 }, children: label }), _jsx(RankBadge, { tier: rank?.tier, division: rank?.division, lp: rank?.lp })] }), total > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { style: { marginTop: 6 }, children: _jsx(WinRateBar, { wins: wins, losses: losses }) }), _jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 4,
                            fontSize: 11,
                            color: c.textDim,
                        }, children: [_jsxs("span", { children: [_jsxs("span", { style: { color: c.win }, children: [wins, "W"] }), " ", _jsxs("span", { style: { color: c.loss }, children: [losses, "L"] })] }), _jsxs("span", { style: { color: wr >= 50 ? c.win : c.loss, fontWeight: 700 }, children: [wr, "%"] })] })] }))] }));
}
function PrefsCard({ card }) {
    if (!card.reputation)
        return null;
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Reputation" }), card.reputation && (_jsxs("div", { style: {
                    display: "flex",
                    gap: 10,
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: `1px solid ${c.border}`,
                    flexWrap: "wrap",
                }, children: [_jsxs(Tag, { color: c.accent, children: [card.reputation.endorsements.goodComms, " Good comms"] }), _jsxs(Tag, { color: c.win, children: [card.reputation.endorsements.goodTeammate, " Good teammate"] }), _jsxs(Tag, { color: c.gold, children: [card.reputation.endorsements.skilled, " Skilled"] })] }))] }));
}
export { titleCase };
