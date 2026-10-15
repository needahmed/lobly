import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { endorse, fetchMyProfiles } from "../api/session";
import { getBridge } from "../shared/bridge";
import { useAppStore } from "../shared/messaging";
import { c, radius } from "./theme";
import { Button, Card, SectionTitle, Tag } from "./components";
import { MatchHistory } from "./MatchHistory";
import { PlayerMenu } from "./PlayerMenu";
const KINDS = [
    { id: "GOOD_COMMS", label: "Comms" },
    { id: "GOOD_TEAMMATE", label: "Teammate" },
    { id: "SKILLED", label: "Skilled" },
];
function hoursLeft() {
    return 23;
}
export function PostGameBanner() {
    const state = useAppStore();
    const post = state.postGame;
    if (!post || post.dismissed || post.mode === "hidden")
        return null;
    if (state.uiTab === "postgame")
        return null;
    const endorseBlock = post.ready?.endorse;
    return (_jsxs("div", { style: {
            margin: "0 28px",
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: radius.md,
            border: `1px solid ${c.borderStrong}`,
            background: c.primarySoft,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
        }, children: [_jsx("span", { style: { flex: 1, fontSize: 13 }, children: endorseBlock
                    ? `Endorse your last teammates (${hoursLeft()} h left)`
                    : "Your last game is ready to review" }), _jsx(Button, { size: "sm", variant: "primary", onClick: () => {
                    getBridge()?.store.update({
                        uiTab: "postgame",
                        postGame: { ...post, mode: "full" },
                    });
                }, children: "Open" }), _jsx(Button, { size: "sm", onClick: () => getBridge()?.store.update({
                    postGame: { ...post, mode: "hidden", dismissed: true },
                }), children: "Dismiss" })] }));
}
export function PostGameView() {
    const state = useAppStore();
    const post = state.postGame;
    const [picked, setPicked] = useState({});
    const [after, setAfter] = useState(null);
    useEffect(() => {
        if (!post?.ready?.profileRefreshed)
            return;
        let cancel = false;
        void fetchMyProfiles()
            .then((cards) => {
            if (cancel)
                return;
            const snap = cards[0]?.snapshot?.solo;
            if (!snap)
                return;
            setAfter({ tier: snap.tier, division: snap.division, lp: snap.lp });
        })
            .catch(() => undefined);
        return () => {
            cancel = true;
        };
    }, [post?.ready?.profileRefreshed, post?.ready?.gameId]);
    if (!post)
        return null;
    const local = post.local;
    const endorseBlock = post.ready?.endorse ?? null;
    const confirmed = post.ready?.riotConfirmed === true;
    const skip = () => {
        getBridge()?.store.update({
            uiTab: state.uiTab === "postgame" ? "listing" : state.uiTab,
            postGame: { ...post, mode: "hidden", dismissed: true },
        });
    };
    const toggle = (accountId, kind) => {
        setPicked((cur) => {
            const have = cur[accountId] ?? [];
            const next = have.includes(kind) ? have.filter((k) => k !== kind) : [...have, kind];
            return { ...cur, [accountId]: next };
        });
    };
    const send = async (accountId) => {
        if (!endorseBlock)
            return;
        const kinds = picked[accountId] ?? [];
        if (!kinds.length)
            return;
        try {
            await endorse(endorseBlock.sessionId, accountId, kinds, post.gameId ?? undefined);
            getBridge()?.setToast("Endorsement sent");
        }
        catch (e) {
            getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Endorse failed");
        }
    };
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsxs(Card, { pad: 20, children: [_jsx(SectionTitle, { right: _jsx(Button, { size: "sm", onClick: skip, children: "Skip" }), children: "Post-game" }), !confirmed && (_jsx("div", { style: { color: c.textDim, fontSize: 13, marginBottom: 12 }, children: "Fetching your game from Riot\u2026" })), local && (_jsxs("div", { style: { display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }, children: [_jsx(Tag, { color: local.win ? c.win : c.loss, children: local.win == null ? "Game" : local.win ? "Victory" : "Defeat" }), _jsxs("span", { style: { fontWeight: 700 }, children: [local.kills ?? 0, "/", local.deaths ?? 0, "/", local.assists ?? 0] }), local.durationSec != null && (_jsxs("span", { style: { color: c.textDim, fontSize: 13 }, children: [Math.floor(local.durationSec / 60), "m ", local.durationSec % 60, "s"] })), post.queueId != null && _jsxs(Tag, { color: c.textDim, children: ["Queue ", post.queueId] })] })), (post.rankBefore || after) && (_jsxs("div", { style: { marginTop: 14, fontSize: 13, color: c.textDim }, children: ["Rank ", post.rankBefore?.tier ?? "—", " ", post.rankBefore?.division ?? "", after ? ` → ${after.tier ?? "—"} ${after.division ?? ""} ${after.lp ?? ""} LP` : ""] }))] }), confirmed && state.riotAccountId && (_jsx(Card, { pad: 8, children: _jsx(MatchHistory, { riotAccountId: state.riotAccountId, queueId: post.queueId ?? undefined }) })), endorseBlock && (_jsxs(Card, { pad: 20, children: [_jsx(SectionTitle, { children: "Endorse teammates" }), endorseBlock.others.map((other) => (_jsxs("div", { style: {
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                            padding: "8px 0",
                        }, children: [_jsxs("span", { style: { fontWeight: 700, minWidth: 140 }, children: [other.riotId, _jsxs("span", { style: { color: c.textFaint }, children: ["#", other.tagLine] })] }), other.role && _jsx(Tag, { color: c.textDim, children: other.role }), KINDS.map((kind) => {
                                const on = (picked[other.accountId] ?? []).includes(kind.id);
                                return (_jsx(Button, { size: "sm", variant: on ? "primary" : undefined, onClick: () => toggle(other.accountId, kind.id), children: kind.label }, kind.id));
                            }), _jsx(Button, { size: "sm", variant: "primary", onClick: () => void send(other.accountId), children: "Send" }), _jsx(PlayerMenu, { accountId: other.accountId, sessionId: endorseBlock.sessionId })] }, other.accountId))), _jsx("div", { style: { marginTop: 8 }, children: _jsx(Button, { size: "sm", onClick: skip, children: "Skip" }) })] }))] }));
}
export function postGameIsFull(state) {
    return state.postGame?.mode === "full" && !state.postGame.dismissed;
}
