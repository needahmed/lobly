import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { ListingStatus, displayQueueLabel, } from "@lobly/shared-types";
import { cancelJoin, decideJoin, endorse, fetchListingRequests, patchListing, reportInviteResult, } from "../api/session";
import { getBridge } from "../shared/bridge";
import { draftToSlots, saveDraftForQueue, } from "../state/publishDraft";
import { c, radius, font } from "./theme";
import { Avatar, Button, Card, EmptyState, PartyStrip, RankBadge, RoleIcon, SectionTitle, StatBlock, Tag, } from "./components";
import { championIcon, useStaticData } from "./useStaticData";
import { PublishForm } from "./PublishForm";
import { PlayerMenu } from "./PlayerMenu";
/* ------------------------------------------------------------- My Lobby */
export function ListingView({ state, bridge, }) {
    const lobby = state.lobby;
    const cap = state.lobbyCapability;
    const queueId = cap?.queueId ?? lobby?.gameConfig?.queueId ?? lobby?.queueId;
    const check = bridge?.canPublish() ?? { ok: false, reason: "Not connected" };
    const status = state.listing.status;
    const live = status === ListingStatus.LISTED ||
        status === ListingStatus.FILLING ||
        status === ListingStatus.READY ||
        status === ListingStatus.PAUSED;
    const [editing, setEditing] = useState(false);
    const draft = state.publishDraft;
    const party = state.party;
    const expiresLabel = useMemo(() => {
        const exp = state.myListing?.expiresAt;
        if (!exp)
            return null;
        const ms = Date.parse(exp) - Date.now();
        if (ms <= 0)
            return "Expired";
        const m = Math.ceil(ms / 60_000);
        return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
    }, [state.myListing?.expiresAt, state.boardRevision]);
    const extend = async () => {
        const id = state.listing.id;
        if (!id || !draft)
            return;
        try {
            const summary = await patchListing(id, { durationMin: draft.durationMin });
            getBridge()?.store.update({ myListing: summary });
            getBridge()?.setToast("Listing extended");
        }
        catch (e) {
            getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Extend failed");
        }
    };
    const saveEdit = async (draft) => {
        const id = state.listing.id;
        if (!id || !cap)
            return;
        try {
            saveDraftForQueue(cap.queueId, draft);
            const summary = await patchListing(id, {
                title: draft.title.trim(),
                description: draft.description.trim() || undefined,
                filters: draft.filters,
                slots: draftToSlots(draft),
                voiceRequired: draft.voiceRequired,
                languages: draft.languages,
                durationMin: draft.durationMin,
            });
            getBridge()?.store.update({ myListing: summary });
            setEditing(false);
            getBridge()?.setToast("Listing updated");
        }
        catch (e) {
            getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Save failed");
        }
    };
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [state.queueDrift && (_jsxs(Card, { pad: 16, children: [_jsx(SectionTitle, { children: "Queue changed" }), _jsx("div", { style: { color: c.textDim, fontSize: 13, marginBottom: 12 }, children: "Your League lobby moved to a different queue, so this listing was taken down. Republish it for the lobby you have open now." }), _jsx(Button, { variant: "primary", onClick: () => bridge?.dispatch({ type: "PUBLISH" }), children: "Republish for this queue" })] })), _jsxs(Card, { pad: 20, style: {
                    background: lobby
                        ? "radial-gradient(circle at 88% 0%, rgba(69,230,174,.13), transparent 34%), linear-gradient(135deg, rgba(14,29,43,.98), rgba(7,13,22,.98))"
                        : undefined,
                    overflow: "hidden",
                }, children: [_jsx(SectionTitle, { right: _jsx(Tag, { color: live ? c.win : c.textDim, bg: live ? c.winSoft : undefined, children: status }), children: "Detected League lobby" }), lobby && cap ? (_jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(5, minmax(110px, 1fr))",
                            gap: 14,
                        }, children: [_jsx(StatBlock, { label: "Queue", value: displayQueueLabel(Number(queueId), cap), sub: `ID ${queueId}` }), _jsx(StatBlock, { label: "Members", value: `${cap.memberCount}/${cap.maxLobbySize}`, sub: `${cap.freeSeats} free` }), _jsx(StatBlock, { label: "Fill style", value: cap.positional ? "Roles" : "Open", sub: cap.isCustom ? "Custom" : cap.gameMode ?? "—" }), _jsx(StatBlock, { label: "Party", value: party ? (_jsx(PartyStrip, { positional: party.positional, count: party.members.length, max: party.maxLobbySize ?? cap.maxLobbySize, filled: party.filledRoles, open: party.openRoles })) : ("—") }), _jsx(StatBlock, { label: "Phase", value: state.gameflowPhase })] })) : (_jsx(EmptyState, { title: "No League lobby open", hint: "Create a lobby in the League client and it will appear here automatically \u2014 Solo/Duo, Flex, ARAM, Mayhem, Custom, and more." }))] }), _jsx(Card, { pad: 20, style: { background: "rgba(9,15,25,.9)" }, children: draft && cap ? (_jsxs(_Fragment, { children: [live && !editing && (_jsxs("div", { style: {
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                                marginBottom: 12,
                                flexWrap: "wrap",
                            }, children: [_jsx(Tag, { color: c.win, children: "Live on Find Team" }), expiresLabel && _jsx(Tag, { color: c.textDim, children: expiresLabel }), _jsx(Button, { size: "sm", onClick: () => setEditing(true), style: { marginLeft: "auto" }, children: "Edit" }), _jsx(Button, { size: "sm", onClick: extend, children: "Extend" })] })), (editing || !live) && (_jsx(PublishForm, { initialDraft: draft, cap: cap, live: live, editing: editing, creatorTier: cap.rankSource === "flex"
                                ? state.profileHints?.flexTier
                                : state.profileHints?.soloTier, creatorDivision: cap.rankSource === "flex"
                                ? state.profileHints?.flexDivision
                                : state.profileHints?.soloDivision, canPublishOk: check.ok, publishReason: check.reason ?? state.publishReason, status: status, onPublish: (d) => {
                                if (bridge?.publish)
                                    bridge.publish(d);
                                else
                                    bridge?.dispatch({ type: "PUBLISH" });
                            }, onUnpublish: () => {
                                setEditing(false);
                                bridge?.dispatch({ type: "UNPUBLISH" });
                            }, onSaveEdit: saveEdit, onQueueAgain: () => bridge?.dispatch({ type: "QUEUE_AGAIN" }) })), live && !editing && (_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }, children: [_jsx(Button, { onClick: () => bridge?.dispatch({ type: "UNPUBLISH" }), children: "Unpublish" }), status === ListingStatus.PAUSED && (_jsx(Button, { onClick: () => bridge?.dispatch({ type: "QUEUE_AGAIN" }), children: "Queue again" }))] }))] })) : (_jsxs(_Fragment, { children: [_jsx(SectionTitle, { children: "Publish to LOBLY" }), !check.ok && (_jsx("div", { style: {
                                background: c.lossSoft,
                                border: `1px solid ${c.loss}33`,
                                color: c.loss,
                                borderRadius: radius.md,
                                padding: "9px 12px",
                                fontSize: 12,
                                marginBottom: 12,
                            }, children: check.reason })), _jsx(EmptyState, { title: "Open a lobby to publish", hint: "Once League reports a lobby, you'll configure roles, rank range, and how many seats you need." })] })) }), state.manualInvite && (_jsxs(Card, { style: { borderColor: `${c.warn}55` }, children: [_jsx(SectionTitle, { children: "Manual invite needed" }), _jsx("p", { style: { color: c.textDim, margin: "0 0 10px", lineHeight: 1.6 }, children: "LOBLY couldn't send the League invite automatically. Invite this player from your League client:" }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("code", { style: {
                                    background: c.bg,
                                    border: `1px solid ${c.border}`,
                                    borderRadius: radius.sm,
                                    padding: "7px 12px",
                                    fontFamily: font.mono,
                                    fontSize: 13,
                                }, children: state.manualInvite.riotId }), _jsx(Button, { onClick: () => {
                                    void navigator.clipboard?.writeText(state.manualInvite.riotId);
                                    getBridge()?.setToast("Riot ID copied");
                                }, children: "Copy" }), state.flags?.inviteAutomation === false && (_jsx(Button, { variant: "primary", onClick: () => {
                                    const id = state.manualInvite.joinRequestId;
                                    void reportInviteResult(id, true)
                                        .then(() => getBridge()?.setToast("Invite marked as sent"))
                                        .catch((e) => getBridge()?.setToast(e?.message ?? "Couldn't report the invite"));
                                }, children: "I've sent the invite" }))] })] }))] }));
}
/* ------------------------------------------------------------- Requests */
export function RequestsView({ state }) {
    const sd = useStaticData();
    const [busy, setBusy] = useState(null);
    const [rows, setRows] = useState(state.pendingRequests ?? []);
    useEffect(() => setRows(state.pendingRequests ?? []), [state.pendingRequests]);
    const refresh = async () => {
        const id = state.listing.id;
        if (!id)
            return;
        try {
            const fetched = await fetchListingRequests(id);
            const pending = fetched
                .filter((r) => r.status === "PENDING")
                .map((r) => ({
                joinRequestId: r.id,
                card: r.card,
                matchScore: r.matchScore ?? 0,
                offRole: r.offRole,
                roleSlot: r.roleSlot,
            }));
            getBridge()?.store.update({ pendingRequests: pending });
        }
        catch (e) {
            getBridge()?.setToast(e?.message ?? "Couldn't refresh requests");
        }
    };
    const decide = async (id, accept) => {
        setBusy(id);
        try {
            await decideJoin(id, accept);
            getBridge()?.setToast(accept ? "Accepted — sending invite" : "Request declined");
        }
        catch (e) {
            getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Action failed");
        }
        finally {
            setBusy(null);
        }
    };
    const outgoing = state.outgoingRequests ?? [];
    if (!rows.length && !outgoing.length) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: "No pending requests", hint: "When someone asks to join your lobby, they'll show up here with their verified profile.", action: state.listing.id ? _jsx(Button, { onClick: refresh, children: "Refresh" }) : undefined }) }));
    }
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsx("div", { style: { display: "flex" }, children: _jsx(Button, { size: "sm", onClick: refresh, style: { marginLeft: "auto" }, children: "Refresh" }) }), outgoing.length > 0 && (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Outgoing" }), outgoing.map((r) => (_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 0",
                            borderTop: `1px solid ${c.border}`,
                        }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 650 }, children: r.creator ? `${r.creator.riotId}#${r.creator.tagLine}` : r.listingTitle ?? "Lobby" }), _jsxs("div", { style: { fontSize: 12, color: c.textDim }, children: [r.status, r.roleSlot ? ` · ${r.roleSlot}` : ""] })] }), (r.status === "PENDING" || r.status === "ACCEPTED") && (_jsx(Button, { size: "sm", disabled: busy === r.id, onClick: () => {
                                    setBusy(r.id);
                                    void cancelJoin(r.id)
                                        .then(() => getBridge()?.setToast("Request cancelled"))
                                        .catch((e) => getBridge()?.setToast(e?.message ?? "Couldn't cancel"))
                                        .finally(() => setBusy(null));
                                }, children: "Cancel" }))] }, r.id)))] })), rows.map((r) => {
                const a = r.card?.account;
                const snap = r.card?.snapshot;
                const champs = r.card?.champions ?? [];
                return (_jsx(Card, { pad: 17, interactive: true, children: _jsxs("div", { style: { display: "flex", gap: 14, alignItems: "flex-start" }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [_jsx("span", { style: { fontWeight: 700, fontSize: 15 }, children: a ? `${a.riotId}#${a.tagLine}` : "Player" }), _jsx(RankBadge, { tier: snap?.solo?.tier, division: snap?.solo?.division, lp: snap?.solo?.lp, size: "sm" }), r.offRole && _jsx(Tag, { color: c.warn, children: "Off-role" }), _jsxs(Tag, { color: r.matchScore >= 75 ? c.win : c.primary, children: [r.matchScore, "% compatible"] })] }), _jsxs("div", { style: {
                                            display: "flex",
                                            gap: 18,
                                            marginTop: 10,
                                            flexWrap: "wrap",
                                            fontSize: 12,
                                            color: c.textDim,
                                        }, children: [r.roleSlot && (_jsxs("span", { style: { display: "inline-flex", gap: 5, alignItems: "center" }, children: [_jsx(RoleIcon, { role: r.roleSlot, size: 13 }), " wants ", r.roleSlot] })), snap?.primaryRole && _jsxs("span", { children: ["Main: ", snap.primaryRole] }), snap?.formWr20 != null && _jsxs("span", { children: ["Form: ", snap.formWr20, "%"] }), snap?.gamesThisSeason != null && _jsxs("span", { children: [snap.gamesThisSeason, " ranked games"] })] }), champs.length > 0 && (_jsxs("div", { style: { display: "flex", gap: 6, marginTop: 10, alignItems: "center" }, children: [_jsx("span", { style: { fontSize: 11, color: c.textFaint }, children: "Plays:" }), champs.slice(0, 5).map((ch) => (_jsx(Avatar, { url: championIcon(sd, ch.championId), size: 24 }, ch.championId)))] }))] }), a?.id && (_jsx(PlayerMenu, { accountId: a.id, pendingJoinRequestId: r.joinRequestId })), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [_jsx(Button, { variant: "primary", disabled: busy === r.joinRequestId, onClick: () => decide(r.joinRequestId, true), children: "Accept" }), _jsx(Button, { variant: "danger", disabled: busy === r.joinRequestId, onClick: () => decide(r.joinRequestId, false), children: "Decline" })] })] }) }, r.joinRequestId));
            })] }));
}
/* -------------------------------------------------------------- Session */
export function SessionView({ state, bridge, }) {
    const [body, setBody] = useState("");
    const [now, setNow] = useState(() => Date.now());
    const scroller = useRef(null);
    const session = state.session;
    const chatLen = session?.chat?.length ?? 0;
    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }, [chatLen, session?.id]);
    useEffect(() => {
        if (!session?.chatOpenUntil)
            return;
        const id = window.setInterval(() => setNow(Date.now()), 5000);
        return () => window.clearInterval(id);
    }, [session?.chatOpenUntil]);
    if (!session) {
        return (_jsx(Card, { children: _jsx(EmptyState, { title: "No active session", hint: "Once you and a teammate are confirmed in the same League lobby, your session chat opens here." }) }));
    }
    const mine = new Set([state.riotAccountId, ...(state.linkedAccountIds ?? [])].filter(Boolean));
    const chatClosed = !!session.chatOpenUntil && Date.parse(session.chatOpenUntil) <= now;
    const send = () => {
        const text = body.trim();
        if (!text || chatClosed)
            return;
        bridge?.sendChat?.(session.id, text);
        setBody("");
    };
    const names = new Map();
    for (const m of session.chat ?? []) {
        const id = m?.from?.accountId;
        if (id && m?.from?.riotId)
            names.set(id, `${m.from.riotId}#${m.from.tagLine ?? ""}`);
    }
    for (const o of state.endorsePrompt?.others ?? []) {
        names.set(o.accountId, `${o.riotId}#${o.tagLine}`);
    }
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsxs(Card, { pad: 0, style: {
                    display: "flex",
                    flexDirection: "column",
                    height: 480,
                    overflow: "hidden",
                    background: "radial-gradient(circle at 100% 0%, rgba(155,123,255,.1), transparent 35%), linear-gradient(145deg, rgba(15,25,40,.98), rgba(7,12,21,.98))",
                }, children: [_jsxs("div", { style: { padding: "16px 18px", borderBottom: `1px solid ${c.border}` }, children: [_jsxs(SectionTitle, { right: _jsxs("div", { style: { display: "flex", gap: 6 }, children: [_jsx(Tag, { color: session.endedAt ? c.textDim : c.win, children: session.endedAt ? "Ended" : "Active" }), _jsx(Button, { size: "sm", onClick: () => getBridge()?.store.update({ session: undefined }), children: "Leave" })] }), children: ["Session chat \u00B7 ", session.memberAccountIds.length, " members"] }), session.memberAccountIds.length > 0 && (_jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }, children: session.memberAccountIds.map((id) => (_jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [_jsx("span", { style: { fontSize: 12, color: c.textDim }, children: names.get(id) ?? id.slice(0, 8) }), !mine.has(id) && _jsx(PlayerMenu, { accountId: id, sessionId: session.id })] }, id))) }))] }), _jsxs("div", { ref: scroller, style: { flex: 1, overflowY: "auto", padding: 18 }, children: [!session.chat?.length && (_jsx("div", { style: { color: c.textFaint, textAlign: "center", paddingTop: 40 }, children: "Say hello \u2014 chat stays open until 10 minutes after your last game." })), (session.chat ?? []).map((m, i) => {
                                const accountId = m.from?.accountId ?? m.fromAccountId;
                                const own = accountId && mine.has(accountId);
                                const label = m.from?.riotId
                                    ? `${m.from.riotId}#${m.from.tagLine ?? ""}`
                                    : (accountId ?? "Player");
                                const when = m.at ?? m.createdAt;
                                return (_jsxs("div", { style: {
                                        marginBottom: 10,
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: own ? "flex-end" : "flex-start",
                                    }, children: [_jsxs("div", { style: { fontSize: 11, color: c.textFaint, marginBottom: 2 }, children: [label, when ? ` · ${formatChatTime(when)}` : ""] }), _jsx("div", { style: {
                                                background: own
                                                    ? "linear-gradient(135deg, rgba(66,215,255,.18), rgba(155,123,255,.12))"
                                                    : "linear-gradient(135deg, rgba(66,215,255,.1), rgba(155,123,255,.08))",
                                                border: `1px solid ${c.border}`,
                                                borderRadius: own
                                                    ? `${radius.lg}px ${radius.sm}px ${radius.lg}px ${radius.lg}px`
                                                    : `${radius.sm}px ${radius.lg}px ${radius.lg}px ${radius.lg}px`,
                                                padding: "9px 13px",
                                                display: "inline-block",
                                                maxWidth: "80%",
                                            }, children: m.body })] }, m.id ?? i));
                            })] }), _jsxs("div", { style: {
                            display: "flex",
                            gap: 8,
                            padding: 14,
                            borderTop: `1px solid ${c.border}`,
                            background: "rgba(4,8,14,.5)",
                        }, children: [_jsx("input", { value: body, disabled: chatClosed, onChange: (e) => setBody(e.target.value), onKeyDown: (e) => e.key === "Enter" && send(), placeholder: chatClosed ? "Chat closed" : "Message your teammates…", style: {
                                    flex: 1,
                                    background: c.surfaceAlt,
                                    border: `1px solid ${c.border}`,
                                    borderRadius: radius.md,
                                    color: c.text,
                                    padding: "9px 12px",
                                    fontSize: 13,
                                } }), _jsx(Button, { variant: "primary", onClick: send, disabled: chatClosed, children: "Send" })] })] }), state.endorsePrompt && (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Endorse your teammates" }), state.endorsePrompt.others.map((o) => (_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 0",
                        }, children: [_jsxs("span", { style: { flex: 1, fontWeight: 600 }, children: [o.riotId, "#", o.tagLine] }), ["GOOD_COMMS", "GOOD_TEAMMATE", "SKILLED"].map((kind) => (_jsx(Button, { size: "sm", onClick: async () => {
                                    try {
                                        await endorse(state.endorsePrompt.sessionId, o.accountId, [kind], state.endorsePrompt.gameId);
                                        getBridge()?.setToast("Endorsement sent");
                                    }
                                    catch (e) {
                                        getBridge()?.setToast(e?.message ?? "Endorse failed");
                                    }
                                }, children: kind === "GOOD_COMMS" ? "Comms" : kind === "GOOD_TEAMMATE" ? "Teammate" : "Skilled" }, kind)))] }, o.accountId)))] }))] }));
}
function formatChatTime(at) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime()))
        return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
