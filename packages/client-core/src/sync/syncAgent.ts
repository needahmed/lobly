import { io, Socket } from "socket.io-client";
import {
  SocketEvents,
  ListingStatus,
  type GameflowPhase,
  type FeatureFlags,
} from "@lobly/shared-types";
import { HEARTBEAT_MS, SYNC_NAMESPACE } from "../constants";
import { getHostAdapter } from "../hostAdapter";
import { appStore } from "../state/store";
import { reportInviteResult, fetchFlags } from "../api/session";

type Queued = { event: string; payload: unknown };

class SyncAgent {
  private socket: Socket | null = null;
  private queue: Queued[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private token = "dev-local";
  private flags: FeatureFlags = {
    inviteAutomation: true,
    autoAccept: true,
    board: true,
    allowedPlatforms: ["euw1"],
  };
  private pendingJoinRequestId: string | null = null;
  private autoAcceptTimer: ReturnType<typeof setInterval> | null = null;
  private lobbyWatchTimer: ReturnType<typeof setInterval> | null = null;

  connect(token?: string) {
    if (token) this.token = token;
    if (this.socket?.connected) return;

    void fetchFlags()
      .then((f) => {
        this.flags = f;
        appStore.update({ flags: f });
      })
      .catch(() => undefined);

    const backendUrl = getHostAdapter().backendUrl;
    this.socket = io(`${backendUrl}${SYNC_NAMESPACE}`, {
      auth: { token: this.token },
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
    });

    this.socket.on(SocketEvents.JOIN_REQUESTED, (payload: any) => {
      appStore.logLine(`join.requested ${payload?.joinRequestId}`);
      const card = payload?.card;
      const name = card?.account
        ? `${card.account.riotId}#${card.account.tagLine}`
        : "player";
      appStore.update({
        pendingRequests: [
          ...(appStore.state.pendingRequests ?? []),
          {
            joinRequestId: payload.joinRequestId,
            card,
            matchScore: payload.matchScore,
            offRole: payload.offRole,
            roleSlot: payload.roleSlot,
          },
        ],
      });
      appStore.setToast(
        `Join request: ${name} · score ${payload?.matchScore ?? "—"}`
      );
    });

    this.socket.on(SocketEvents.JOIN_ACCEPTED, (payload: any) => {
      appStore.logLine(`join.accepted: ${JSON.stringify(payload)}`);
      void import("../state/listingMachine").then(({ dispatchMachine }) => {
        if (payload?.invitee) dispatchMachine({ type: "JOIN_ACCEPTED" });
      });
      void this.handleJoinAccepted(payload);
    });

    this.socket.on(SocketEvents.JOIN_DECLINED, (payload: any) => {
      appStore.setToast("Join request declined");
      appStore.logLine(`join.declined ${payload?.joinRequestId}`);
    });

    this.socket.on(SocketEvents.JOIN_FAILED, (payload: any) => {
      this.clearAutoAccept();
      appStore.setToast(
        payload?.code === "NO_SHOW"
          ? "Invite expired"
          : "Join failed — try another listing"
      );
    });

    this.socket.on(SocketEvents.JOIN_REOPENED, () => {
      appStore.setToast("Slot reopened");
      void import("../state/listingMachine").then(({ dispatchMachine }) => {
        dispatchMachine({ type: "SLOT_REOPENED" });
      });
    });

    this.socket.on(SocketEvents.SESSION_ACTIVE, (payload: any) => {
      appStore.update({
        session: {
          id: payload.sessionId,
          memberAccountIds: payload.memberAccountIds ?? [],
          chat: appStore.state.session?.chat ?? [],
        },
      });
      appStore.setToast("Session active — you're in the lobby");
      void import("../state/listingMachine").then(({ dispatchMachine }) => {
        dispatchMachine({ type: "MEMBER_ARRIVED" });
      });
    });

    this.socket.on(SocketEvents.CHAT_MESSAGE, (payload: any) => {
      const chat = [...(appStore.state.session?.chat ?? []), payload];
      appStore.update({
        session: {
          id: payload.sessionId,
          memberAccountIds: appStore.state.session?.memberAccountIds ?? [],
          chat,
        },
      });
      // Toast only when the main UI window is hidden/minimized — best-effort.
      void getHostAdapter()
        .isDesktopHidden()
        .then((hidden) => {
          if (hidden) appStore.setToast(`Chat: ${payload.body}`);
        })
        .catch(() => undefined);
    });

    this.socket.on(SocketEvents.ENDORSE_PROMPT, (payload: any) => {
      appStore.update({ endorsePrompt: payload });
      appStore.setToast("Endorse your teammates");
    });

    this.socket.on(SocketEvents.LISTING_STATE, (payload: any) => {
      if (payload?.listingId && payload?.status) {
        appStore.update({
          listing: {
            id: payload.listingId,
            status: payload.status as ListingStatus,
          },
        });
      }
    });

    this.socket.on(SocketEvents.BOARD_DELTA, (payload: any) => {
      const board = [...(appStore.state.board ?? [])] as any[];
      if (payload?.remove) {
        appStore.update({
          board: board.filter((r) => r?.listing?.id !== payload.remove),
          boardRevision: (appStore.state.boardRevision ?? 0) + 1,
        });
      } else if (payload?.upsert) {
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

  send(event: string, payload: unknown = {}) {
    if (this.socket?.connected) {
      this.socket.emit(event, payload, (ack: any) => {
        if (ack?.serverStatus) {
          appStore.logLine(`sync ack ${event} → ${ack.serverStatus}`);
        }
      });
    } else {
      this.queue.push({ event, payload });
      appStore.logLine(`sync queued ${event} (offline)`);
    }
  }

  sendChat(sessionId: string, body: string) {
    this.send(SocketEvents.CHAT_SEND, { sessionId, body });
  }

  private reconcile() {
    const { listing, gameflowPhase } = appStore.state;
    this.send(SocketEvents.STATE_RECONCILE, {
      listingStatus: listing.status,
      phase: gameflowPhase,
      listingId: listing.id,
    });
  }

  private flush() {
    const pending = this.queue.splice(0);
    for (const item of pending) {
      this.send(item.event, item.payload);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const { gameflowPhase, listing, summoner } = appStore.state;
      this.send(SocketEvents.PRESENCE_HEARTBEAT, {
        phase: gameflowPhase as GameflowPhase,
        listingStatus: listing.status as ListingStatus,
        observedPuuid: summoner?.puuid,
        listingId: listing.id,
      });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private async handleJoinAccepted(payload: any) {
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

      if (!this.flags.inviteAutomation) {
        appStore.setToast(`Invite manually: ${manualFallback}`);
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
      } catch (e: any) {
        appStore.logLine(`Invite failed: ${e?.message ?? e}`);
        appStore.setToast(`Invite failed — copy ${manualFallback} and invite manually`);
        await reportInviteResult(payload.joinRequestId, false, String(e?.message ?? e));
      }
      return;
    }

    // Requester path: has creator
    if (payload?.creator) {
      this.pendingJoinRequestId = payload.joinRequestId;
      const autoOn =
        this.flags.autoAccept &&
        (appStore.state.autoAcceptLoblyInvites ?? false);
      if (autoOn) {
        appStore.setToast(
          `Waiting to auto-accept invite from ${payload.creator.riotId}`
        );
        this.startAutoAccept(
          payload.joinRequestId,
          Number(payload.creator.summonerId)
        );
      } else {
        appStore.setToast(
          `Accept the League invite from ${payload.creator.riotId}!`
        );
        this.startLobbyWatchSelf(payload.joinRequestId);
      }
    }
  }

  private startAutoAccept(joinRequestId: string, fromSummonerId: number) {
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
          const invites = (await transport.request<any[]>("receivedInvitations")) ?? [];
          const match = invites.find(
            (i) => Number(i.fromSummonerId ?? i.fromSummonerId) === fromSummonerId
              || Number(i?.fromSummonerId) === fromSummonerId
          );
          const invitationId = match?.invitationId ?? match?.id;
          if (!invitationId) return;
          await transport.request("acceptInvitation", {
            params: { invitationId: String(invitationId) },
          });
          appStore.logLine("Auto-accepted LOBLY invite");
          this.clearAutoAccept();
          this.send(SocketEvents.LOBBY_CONFIRMED, { joinRequestId });
        } catch (e: any) {
          appStore.logLine(`auto-accept tick: ${e?.message ?? e}`);
        }
      })();
    }, 5000);
  }

  private startLobbyWatch(joinRequestId: string, memberSummonerId: number) {
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
          const members = (await transport.request<any[]>("lobbyMembers")) ?? [];
          const found = members.some(
            (m) => Number(m.summonerId ?? m.id) === memberSummonerId
          );
          if (found) {
            this.clearLobbyWatch();
            this.send(SocketEvents.LOBBY_CONFIRMED, { joinRequestId });
            appStore.logLine("lobby.confirmed (creator saw member)");
          }
        } catch {
          /* no lobby */
        }
      })();
    }, 3000);
  }

  private startLobbyWatchSelf(joinRequestId: string) {
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
          const members = (await transport.request<any[]>("lobbyMembers")) ?? [];
          const found =
            myId != null &&
            members.some((m) => Number(m.summonerId ?? m.id) === myId);
          if (found && members.length >= 2) {
            this.clearLobbyWatch();
            this.send(SocketEvents.LOBBY_CONFIRMED, { joinRequestId });
            appStore.logLine("lobby.confirmed (requester side)");
          }
        } catch {
          /* ignore */
        }
      })();
    }, 3000);
  }

  private clearAutoAccept() {
    if (this.autoAcceptTimer) clearInterval(this.autoAcceptTimer);
    this.autoAcceptTimer = null;
  }

  private clearLobbyWatch() {
    if (this.lobbyWatchTimer) clearInterval(this.lobbyWatchTimer);
    this.lobbyWatchTimer = null;
  }
}

export const syncAgent = new SyncAgent();
