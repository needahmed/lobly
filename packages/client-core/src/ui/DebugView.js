import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { redactPuuid } from "../shared/log";
import { c, radius, font } from "./theme";
import { Button, Card, SectionTitle, Tag } from "./components";
export function DebugView({ state, bridge, }) {
    const [inviteId, setInviteId] = useState("");
    const [out, setOut] = useState("");
    const facts = [
        ["League client", state.lcu.connected ? `connected :${state.lcu.port}` : "not connected"],
        ["Gameflow phase", state.gameflowPhase],
        ["LOBLY server", state.sync.connected ? "connected" : "disconnected"],
        ["Riot ID", state.summoner ? `${state.summoner.gameName}#${state.summoner.tagLine}` : "—"],
        ["Platform", state.summoner?.platform ?? "—"],
        ["LCU puuid", redactPuuid(state.summoner?.puuid) || "—"],
        ["summonerId", String(state.summoner?.summonerId ?? "—")],
        ["Linked account", state.riotAccountId ?? "not linked"],
        ["Listing", `${state.listing.status}${state.listing.id ? ` (${state.listing.id.slice(0, 8)})` : ""}`],
        ["GEP features", state.gep.active ? state.gep.features.join(", ") || "active" : "inactive"],
        ["LCU WebSocket", state.wsAvailable ? "connected" : "not connected"],
        [
            "Party",
            state.party?.members.length
                ? state.party.members
                    .map((m) => {
                    const role = m.champSelect?.assignedRole ?? m.roles[0] ?? "FILL";
                    return `${m.riotId ?? `#${m.summonerId}`}${m.isLocal ? " (you)" : ""} · ${role}`;
                })
                    .join(", ")
                : "—",
        ],
        [
            "Open roles",
            state.party?.positional ? state.party.openRoles.join(", ") || "none" : "n/a",
        ],
        ["Game id", state.party?.gameId != null ? String(state.party.gameId) : "—"],
    ];
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsxs(Card, { pad: 20, style: {
                    background: "radial-gradient(circle at 88% 0%, rgba(66,215,255,.11), transparent 34%), linear-gradient(145deg, rgba(15,26,42,.98), rgba(7,12,21,.98))",
                }, children: [_jsx(SectionTitle, { children: "Connection status" }), _jsx("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                            gap: 8,
                            fontSize: 12,
                        }, children: facts.map(([k, v]) => (_jsxs("div", { style: {
                                padding: "10px 12px",
                                background: "rgba(255,255,255,.025)",
                                border: `1px solid ${c.border}`,
                                borderRadius: radius.md,
                                minWidth: 0,
                            }, children: [_jsx("div", { style: { color: c.textFaint, fontSize: 9, textTransform: "uppercase", letterSpacing: .8 }, children: k }), _jsx("div", { className: "lobly-truncate", style: { fontFamily: font.mono, marginTop: 4, color: c.text }, children: v })] }, k))) })] }), _jsxs(Card, { style: { background: "rgba(9,15,25,.88)" }, children: [_jsx(SectionTitle, { children: "State machine" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx(Button, { size: "sm", onClick: () => bridge?.dispatch({ type: "JOIN_ACCEPTED" }), children: "Simulate JOIN_ACCEPTED" }), _jsx(Button, { size: "sm", onClick: () => bridge?.dispatch({ type: "MEMBER_ARRIVED" }), children: "Simulate MEMBER_ARRIVED" }), _jsx(Button, { size: "sm", onClick: () => bridge?.dispatch({ type: "SLOT_REOPENED" }), children: "Simulate SLOT_REOPENED" }), _jsx(Button, { size: "sm", onClick: () => bridge?.dispatch({ type: "EXPIRED" }), children: "Simulate EXPIRED" })] })] }), bridge?.spike && (_jsxs(Card, { style: { background: "rgba(9,15,25,.88)" }, children: [_jsx(SectionTitle, { children: "LCU lab" }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [_jsx(Button, { size: "sm", onClick: async () => {
                                    try {
                                        setOut(await bridge.spike.restGet());
                                    }
                                    catch (e) {
                                        setOut(String(e?.message ?? e));
                                    }
                                }, children: "GET current-summoner" }), _jsx("input", { value: inviteId, onChange: (e) => setInviteId(e.target.value), placeholder: "toSummonerId", style: {
                                    background: c.bg,
                                    border: `1px solid ${c.border}`,
                                    borderRadius: radius.md,
                                    color: c.text,
                                    padding: "6px 10px",
                                    fontSize: 12,
                                    width: 180,
                                    fontFamily: font.mono,
                                } }), _jsx(Button, { size: "sm", onClick: async () => {
                                    try {
                                        setOut(await bridge.spike.restPost(Number(inviteId)));
                                    }
                                    catch (e) {
                                        setOut(String(e?.message ?? e));
                                    }
                                }, children: "Send test invite" })] }), out && (_jsx("pre", { style: {
                            marginTop: 12,
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            borderRadius: radius.md,
                            padding: 12,
                            fontSize: 11,
                            maxHeight: 220,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            color: c.textDim,
                        }, children: out }))] })), _jsxs(Card, { style: { background: "rgba(7,12,20,.92)" }, children: [_jsx(SectionTitle, { right: _jsxs(Tag, { color: c.textFaint, children: [state.log.length, " lines"] }), children: "Event log" }), _jsxs("div", { style: {
                            background: c.bgDeep,
                            border: `1px solid ${c.border}`,
                            borderRadius: radius.md,
                            padding: 10,
                            maxHeight: 320,
                            overflowY: "auto",
                            fontFamily: font.mono,
                            fontSize: 11,
                            lineHeight: 1.7,
                        }, children: [state.log.length === 0 && _jsx("span", { style: { color: c.textFaint }, children: "No events yet." }), state.log
                                .slice(-80)
                                .reverse()
                                .map((line, i) => {
                                const space = line.indexOf(" ");
                                const ts = line.slice(0, space);
                                const msg = line.slice(space + 1);
                                return (_jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("span", { style: { color: c.textFaint, flexShrink: 0 }, children: ts.slice(11, 19) }), _jsx("span", { style: { color: c.textDim }, children: msg })] }, i));
                            })] })] })] }));
}
