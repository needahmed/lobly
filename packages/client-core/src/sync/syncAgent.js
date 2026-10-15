import { io } from "socket.io-client";
import { SocketEvents, ListingStatus, } from "@lobly/shared-types";
import { HEARTBEAT_MS, SYNC_NAMESPACE } from "../constants";
import { getHostAdapter } from "../hostAdapter";
import { appStore } from "../state/store";
import { getAccessToken, refreshAccessToken } from "../api/client";
import { reportInviteResult, fetchFlags, fetchMyListing, mergeSessionMessages, normalizeChatMessage, } from "../api/session";
class SyncAgent {
    socket = null;
    queue = [];
    heartbeat = null;
    token = "";
    authRefreshInFlight = false;
    flags = {
        inviteAutomation: true,
        autoAccept: true,
        board: true,
        allowedPlatforms: ["euw1"],
        partySync: true,
        postgameLoop: true,
        organicEndorse: false,
        clientLobbyWatch: true,
    };
    pendingJoinRequestId = null;
    autoAcceptTimer = null;
    lobbyWatchTimer = null;
    connect(token) {
        if (token)
            this.token = token;
        const next = getAccessToken() ?? (this.token || "");
        if (!next) {
            appStore.logLine("Sync connect skipped — not signed in");
            return;
        }
        this.token = next;
        if (this.socket?.connected)
            return;
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        void fetchFlags()
            .then((f) => {
            this.flags = f;
            appStore.update({ flags: f });
        })
            .catch(() => undefined);
        const backendUrl = getHostAdapter().backendUrl;
        this.socket = io(`${backendUrl}${SYNC_NAMESPACE}`, {
            auth: (cb) => {
                cb({ token: getAccessToken() ?? this.token });
            },
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10_000,
        });
        this.socket.on("connect", () => {
            appStore.update({ sync: { connected: true } });
            appStore.logLine("Sync agent connected");
            this.flush();
            this.startHeartbeat();
            this.reconcile();
        });
        this.socket.on("disconnect", () => {
            appStore.update({ sync: { connected: false } });
            appStore.logLine("Sync agent disconnected");
            this.stopHeartbeat();
        });
        this.socket.on("connect_error", (err) => {
            appStore.logLine(`Sync connect_error: ${err.message}`);
            if (err.message !== "unauthorized" || this.authRefreshInFlight)
                return;
            this.authRefreshInFlight = true;
            void refreshAccessToken()
                .then((ok) => {
                if (ok) {
                    this.socket?.connect();
                }
                else {
                    appStore.update({ authExpired: true, authenticated: false });
                    this.socket?.disconnect();
                }
            })
                .finally(() => {
                this.authRefreshInFlight = false;
            });
        });
        this.socket.on(SocketEvents.JOIN_REQUESTED, (payload) => {
            appStore.logLine(`join.requested ${payload?.joinRequestId}`);
            const card = payload?.card;
            const name = card?.account
                ? `${card.account.riotId}#${card.account.tagLine}`
                : "player";
            const existing = appStore.state.pendingRequests ?? [];
            const row = {
                joinRequestId: payload.joinRequestId,
                card,
                matchScore: payload.matchScore,
                offRole: payload.offRole,
                roleSlot: payload.roleSlot,
            };
            const idx = existing.findIndex((r) => r.joinRequestId === payload.joinRequestId);
            const pendingRequests = idx >= 0
                ? existing.map((r, i) => (i === idx ? row : r))
                : [...existing, row];
            appStore.update({ pendingRequests });
            if (payload.replay)
                return;
            appStore.setToast(`Join request: ${name} · score ${payload?.matchScore ?? "—"}`);
            this.notify("Join request", `${name} wants to join your lobby`, "requests");
        });
        this.socket.on(SocketEvents.JOIN_ACCEPTED, (payload) => {
            appStore.logLine(`join.accepted: ${JSON.stringify(payload)}`);
            this.markOutgoing(payload?.joinRequestId, "ACCEPTED");
            void import("../state/listingMachine").then(({ dispatchMachine }) => {
                if (payload?.invitee)
                    dispatchMachine({ type: "JOIN_ACCEPTED" });
            });
            void this.handleJoinAccepted(payload);
        });
        this.socket.on(SocketEvents.JOIN_DECLINED, (payload) => {
            this.markOutgoing(payload?.joinRequestId, "DECLINED");
            appStore.setToast("Join request declined");
            appStore.logLine(`join.declined ${payload?.joinRequestId}`);
        });
        this.socket.on(SocketEvents.JOIN_FAILED, (payload) => {
            this.clearAutoAccept();
            this.markOutgoing(payload?.joinRequestId, "FAILED");
            const message = payload?.code === "NO_SHOW"
                ? "Invite expired"
                : payload?.code === "INVITE_NOT_SENT"
                    ? "The invite was never sent"
                    : "Join failed — try another listing";
            appStore.setToast(message);
            this.notify("Join failed", message, "board");
        });
        this.socket.on(SocketEvents.JOIN_CANCELLED, (payload) => {
            const id = payload?.joinRequestId;
            if (!id)
                return;
            appStore.update({
                pendingRequests: (appStore.state.pendingRequests ?? []).filter((r) => r.joinRequestId !== id),
            });
            this.markOutgoing(id, "CANCELLED");
        });
        this.socket.on(SocketEvents.JOIN_REOPENED, () => {
            appStore.setToast("Slot reopened");
            void import("../state/listingMachine").then(({ dispatchMachine }) => {
                dispatchMachine({ type: "SLOT_REOPENED" });
            });
        });
        this.socket.on(SocketEvents.SESSION_ACTIVE, (payload) => {
            const same = appStore.state.session?.id === payload.sessionId;
            appStore.update({
                session: {
                    id: payload.sessionId,
                    memberAccountIds: payload.memberAccountIds ?? [],
                    chat: same ? (appStore.state.session?.chat ?? []) : [],
                    endedAt: payload.endedAt ?? null,
                    chatOpenUntil: payload.chatOpenUntil ?? null,
                },
            });
            appStore.setToast("Session active — you're in the lobby");
            this.notify("Session active", "You're in the lobby", "session");
            this.go("session");
            void mergeSessionMessages(payload.sessionId).catch((e) => appStore.logLine(`chat history: ${e?.message ?? e}`));
            void import("../state/listingMachine").then(({ dispatchMachine }) => {
                dispatchMachine({ type: "MEMBER_ARRIVED" });
            });
        });
        this.socket.on(SocketEvents.SESSION_ENDED, (payload) => {
            const cur = appStore.state.session;
            if (!cur || cur.id !== payload.sessionId)
                return;
            appStore.update({
                session: {
                    ...cur,
                    endedAt: cur.endedAt ?? new Date().toISOString(),
                    chatOpenUntil: payload.chatOpenUntil,
                },
            });
            appStore.setToast("Session ended — chat stays open for a few minutes");
        });
        this.socket.on(SocketEvents.CHAT_MESSAGE, (payload) => {
            const norm = normalizeChatMessage(payload);
            const prev = appStore.state.session?.chat ?? [];
            if (prev.some((m) => Number(m.id) === norm.id))
                return;
            const chat = [...prev, norm];
            appStore.update({
                session: {
                    id: payload.sessionId,
                    memberAccountIds: appStore.state.session?.memberAccountIds ?? [],
                    chat,
                    endedAt: appStore.state.session?.endedAt,
                    chatOpenUntil: appStore.state.session?.chatOpenUntil,
                },
            });
            void getHostAdapter()
                .isDesktopHidden()
                .then((hidden) => {
                if (!hidden)
                    return;
                appStore.setToast(`Chat: ${payload.body}`);
                this.notify("LOBLY chat", String(payload.body ?? ""), "session");
            })
                .catch(() => undefined);
        });
        this.socket.on(SocketEvents.ENDORSE_PROMPT, (payload) => {
            appStore.update({ endorsePrompt: payload });
            appStore.setToast("Endorse your teammates");
        });
        this.socket.on(SocketEvents.POSTGAME_READY, (payload) => {
            const cur = appStore.state.postGame;
            const endorse = payload.endorse
                ? { ...payload.endorse, gameId: payload.gameId }
                : null;
            appStore.update({
                endorsePrompt: endorse,
                postGame: {
                    gameId: payload.gameId,
                    queueId: cur?.queueId ?? null,
                    local: cur?.local ?? null,
                    ready: payload,
                    mode: cur?.mode === "full" ? "full" : cur?.dismissed ? "hidden" : "banner",
                    dismissed: cur?.dismissed ?? false,
                    rankBefore: cur?.rankBefore ?? null,
                },
            });
            if (!payload.endorse)
                return;
            appStore.setToast("Endorse your last teammates");
            void getHostAdapter()
                .isDesktopHidden()
                .then((hidden) => {
                if (hidden)
                    this.notify("Game finished", "Endorse your last teammates", "postgame");
            })
                .catch(() => undefined);
        });
        this.socket.on(SocketEvents.LISTING_STATE, (payload) => {
            if (payload?.listingId && payload?.status) {
                const prevId = appStore.state.myListing?.id ?? appStore.state.listing.id;
                const queueDrift = payload.reason === "QUEUE_CHANGED" || appStore.state.queueDrift;
                appStore.update({
                    queueDrift: payload.reason === "QUEUE_CHANGED" ? true : queueDrift && payload.status !== ListingStatus.LISTED,
                    listing: {
                        id: payload.listingId,
                        status: payload.status,
                    },
                });
                if (payload.listingId !== prevId) {
                    void fetchMyListing()
                        .then((mine) => {
                        if (!mine)
                            return;
                        appStore.update({
                            myListing: mine,
                            listing: { id: mine.id, status: mine.status },
                        });
                    })
                        .catch((e) => appStore.logLine(`listing refresh: ${e?.message ?? e}`));
                }
            }
        });
        this.socket.on(SocketEvents.BOARD_DELTA, (payload) => {
            const board = [...(appStore.state.board ?? [])];
            if (payload?.remove) {
                appStore.update({
                    board: board.filter((r) => r?.listing?.id !== payload.remove),
                    boardRevision: (appStore.state.boardRevision ?? 0) + 1,
                });
            }
            else if (payload?.upsert) {
                appStore.update({
                    boardRevision: (appStore.state.boardRevision ?? 0) + 1,
                });
            }
        });
    }
    disconnect() {
        this.stopHeartbeat();
        this.clearAutoAccept();
        this.clearLobbyWatch();
        this.socket?.disconnect();
        this.socket = null;
    }
    send(event, payload = {}) {
        if (this.socket?.connected) {
            this.socket.emit(event, payload, (ack) => {
                if (ack?.serverStatus) {
                    appStore.logLine(`sync ack ${event} → ${ack.serverStatus}`);
                }
            });
        }
        else {
            this.queue.push({ event, payload });
            appStore.logLine(`sync queued ${event} (offline)`);
        }
    }
    sendChat(sessionId, body) {
        const payload = { sessionId, body };
        if (!this.socket?.connected) {
            this.queue.push({ event: SocketEvents.CHAT_SEND, payload });
            appStore.logLine("sync queued chat.send (offline)");
            return;
        }
        this.socket.emit(SocketEvents.CHAT_SEND, payload, (ack) => {
            if (!ack || ack.ok !== false || !ack.error)
                return;
            appStore.setToast(chatAckText(ack.error));
        });
    }
    reconcile() {
        const { listing, gameflowPhase, session } = appStore.state;
        this.send(SocketEvents.STATE_RECONCILE, {
            listingStatus: listing.status,
            phase: gameflowPhase,
            listingId: listing.id,
        });
        if (session?.id) {
            void mergeSessionMessages(session.id).catch((e) => appStore.logLine(`chat history: ${e?.message ?? e}`));
        }
    }
    flush() {
        const pending = this.queue.splice(0);
        for (const item of pending) {
            this.send(item.event, item.payload);
        }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeat = setInterval(() => {
            const { gameflowPhase, listing, summoner, party, gameContext } = appStore.state;
            this.send(SocketEvents.PRESENCE_HEARTBEAT, {
                phase: gameflowPhase,
                listingStatus: listing.status,
                observedPuuid: summoner?.puuid,
                listingId: listing.id,
                partyId: party?.partyId ?? undefined,
                gameId: gameContext?.gameId ?? undefined,
            });
        }, HEARTBEAT_MS);
    }
    stopHeartbeat() {
        if (this.heartbeat)
            clearInterval(this.heartbeat);
        this.heartbeat = null;
    }
    async handleJoinAccepted(payload) {
        const transport = getHostAdapter().lcuTransport;
        // Creator path: has invitee → fire LCU invite
        if (payload?.invitee?.summonerId) {
            this.pendingJoinRequestId = payload.joinRequestId;
            const manualFallback = `${payload.invitee.riotId}#${payload.invitee.tagLine}`;
            appStore.update({
                manualInvite: {
                    joinRequestId: payload.joinRequestId,
                    riotId: manualFallback,
                },
            });
            this.go("listing");
            if (!this.flags.inviteAutomation) {
                appStore.setToast(`Invite manually: ${manualFallback}`);
                this.notify("Send the League invite", `Invite ${manualFallback} from the League client`, "listing");
                return;
            }
            try {
                await transport.request("sendInvite", {
                    body: [{ toSummonerId: Number(payload.invitee.summonerId) }],
                });
                appStore.logLine(`LCU invite sent to ${payload.invitee.summonerId}`);
                appStore.setToast(`Invite sent → ${manualFallback}`);
                await reportInviteResult(payload.joinRequestId, true);
                this.startLobbyWatch(payload.joinRequestId, Number(payload.invitee.summonerId));
            }
            catch (e) {
                appStore.logLine(`Invite failed: ${e?.message ?? e}`);
                appStore.setToast(`Invite failed — copy ${manualFallback} and invite manually`);
                await reportInviteResult(payload.joinRequestId, false, String(e?.message ?? e));
            }
            return;
        }
        // Requester path: has creator
        if (payload?.creator) {
            this.pendingJoinRequestId = payload.joinRequestId;
            this.go("session");
            const inviteLine = `Accept the League invite from ${payload.creator.riotId}`;
            this.notify("Lobby invite", inviteLine, "session");
            const autoOn = this.flags.autoAccept &&
                (appStore.state.autoAcceptLoblyInvites ?? false);
            if (autoOn) {
                appStore.setToast(`Waiting to auto-accept invite from ${payload.creator.riotId}`);
                this.startAutoAccept(payload.joinRequestId, Number(payload.creator.summonerId));
            }
            else {
                appStore.setToast(`Accept the League invite from ${payload.creator.riotId}!`);
                this.startLobbyWatchSelf(payload.joinRequestId);
            }
        }
    }
    startAutoAccept(joinRequestId, fromSummonerId) {
        this.clearAutoAccept();
        const transport = getHostAdapter().lcuTransport;
        let ticks = 0;
        this.autoAcceptTimer = setInterval(() => {
            void (async () => {
                ticks++;
                if (ticks > 18) {
                    this.clearAutoAccept();
                    return;
                }
                try {
                    const invites = (await transport.request("receivedInvitations")) ?? [];
                    const match = invites.find((i) => Number(i.fromSummonerId ?? i.fromSummonerId) === fromSummonerId
                        || Number(i?.fromSummonerId) === fromSummonerId);
                    const invitationId = match?.invitationId ?? match?.id;
                    if (!invitationId)
                        return;
                    await transport.request("acceptInvitation", {
                        params: { invitationId: String(invitationId) },
                    });
                    appStore.logLine("Auto-accepted LOBLY invite");
                    this.clearAutoAccept();
                    this.send(SocketEvents.LOBBY_CONFIRMED, { joinRequestId });
                }
                catch (e) {
                    appStore.logLine(`auto-accept tick: ${e?.message ?? e}`);
                }
            })();
        }, 5000);
    }
    startLobbyWatch(joinRequestId, memberSummonerId) {
        if (this.flags.clientLobbyWatch === false)
            return;
        this.clearLobbyWatch();
        const transport = getHostAdapter().lcuTransport;
        let ticks = 0;
        this.lobbyWatchTimer = setInterval(() => {
            void (async () => {
                ticks++;
                if (ticks > 20) {
                    this.clearLobbyWatch();
                    return;
                }
                try {
                    const members = (await transport.request("lobbyMembers")) ?? [];
                    const found = members.some((m) => Number(m.summonerId ?? m.id) === memberSummonerId);
                    if (found) {
                        this.clearLobbyWatch();
                        this.send(SocketEvents.LOBBY_CONFIRMED, { joinRequestId });
                        appStore.logLine("lobby.confirmed (creator saw member)");
                    }
                }
                catch {
                    /* no lobby */
                }
            })();
        }, 3000);
    }
    startLobbyWatchSelf(joinRequestId) {
        if (this.flags.clientLobbyWatch === false)
            return;
        this.clearLobbyWatch();
        const transport = getHostAdapter().lcuTransport;
        let ticks = 0;
        const myId = appStore.state.summoner?.summonerId;
        this.lobbyWatchTimer = setInterval(() => {
            void (async () => {
                ticks++;
                if (ticks > 20) {
                    this.clearLobbyWatch();
                    return;
                }
                try {
                    const members = (await transport.request("lobbyMembers")) ?? [];
                    const found = myId != null &&
                        members.some((m) => Number(m.summonerId ?? m.id) === myId);
                    if (found && members.length >= 2) {
                        this.clearLobbyWatch();
                        this.send(SocketEvents.LOBBY_CONFIRMED, { joinRequestId });
                        appStore.logLine("lobby.confirmed (requester side)");
                    }
                }
                catch {
                    /* ignore */
                }
            })();
        }, 3000);
    }
    clearAutoAccept() {
        if (this.autoAcceptTimer)
            clearInterval(this.autoAcceptTimer);
        this.autoAcceptTimer = null;
    }
    clearLobbyWatch() {
        if (this.lobbyWatchTimer)
            clearInterval(this.lobbyWatchTimer);
        this.lobbyWatchTimer = null;
    }
    markOutgoing(id, status) {
        if (!id)
            return;
        const cur = appStore.state.outgoingRequests ?? [];
        if (!cur.some((r) => r.id === id))
            return;
        appStore.update({
            outgoingRequests: cur.map((r) => (r.id === id ? { ...r, status } : r)),
        });
    }
    notify(title, body, tab) {
        if (appStore.state.notificationsEnabled === false)
            return;
        try {
            getHostAdapter().notify?.(title, body, tab ? { tab } : undefined);
        }
        catch {
            /* notifications are best-effort */
        }
    }
    go(tab) {
        appStore.update({ uiTab: tab });
    }
}
function chatAckText(error) {
    if (error.includes("CHAT_RATE"))
        return "You're sending messages too fast";
    if (error.includes("BLOCKED"))
        return "You can't message this lobby";
    if (error.includes("CHAT_CLOSED"))
        return "Chat closed";
    return error;
}
export const syncAgent = new SyncAgent();
