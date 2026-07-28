import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Inject, Logger, forwardRef } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { SocketEvents, ListingStatus } from "@lobly/shared-types";
import { ListingsService } from "../lobby/listings.service";
import { RiotAccountsService } from "../identity/riot-accounts.service";
import { PresenceService } from "./presence.service";
import { RealtimeFanoutService } from "./realtime-fanout.service";
import { JoinService } from "../join/join.service";
import { SessionService } from "../session/session.service";

type Ack = (payload: { ok: boolean; serverStatus?: string; error?: string }) => void;

@WebSocketGateway({
  namespace: "/sync",
  cors: { origin: true, credentials: true },
})
export class SyncGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(SyncGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly listings: ListingsService,
    private readonly accounts: RiotAccountsService,
    private readonly presence: PresenceService,
    private readonly fanout: RealtimeFanoutService,
    @Inject(forwardRef(() => JoinService))
    private readonly joins: JoinService,
    @Inject(forwardRef(() => SessionService))
    private readonly sessions: SessionService
  ) {}

  afterInit(server: Server) {
    const url = this.config.getOrThrow<string>("REDIS_URL");
    const pub = new Redis(url, { maxRetriesPerRequest: null });
    const sub = new Redis(url, { maxRetriesPerRequest: null });
    // @WebSocketGateway({ namespace: "/sync" }) injects the Namespace, not
    // the root Server — only the root has .adapter() as a setter method.
    const rootServer = (server as unknown as { server: Server }).server;
    rootServer.adapter(createAdapter(pub, sub) as never);
    this.fanout.bind(this);
    this.presence.startExpiryWatcher();
    this.logger.log("Sync gateway ready (/sync) with Redis adapter");
  }

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers.authorization?.replace(/^Bearer\s+/i, "") as
        | string
        | undefined);

    if (!token) {
      this.logger.warn(`reject ${client.id}: no token`);
      client.disconnect(true);
      return;
    }

    let userId: string | null = null;
    if (token.startsWith("dev-")) {
      userId = `dev:${token}`;
    } else {
      try {
        const payload = this.jwt.verify<{ sub: string }>(token, {
          secret: this.config.getOrThrow<string>("JWT_SECRET"),
        });
        userId = payload.sub;
      } catch {
        this.logger.warn(`reject ${client.id}: bad jwt`);
        client.disconnect(true);
        return;
      }
    }

    client.data.userId = userId;
    await client.join(this.fanout.userRoom(userId));

    // dev: pseudo-users aren't real accounts — they have no UUID and no
    // listings, so presence tracking and account lookups must skip them
    // (presence.watchUser feeds a sweeper that runs real UUID-keyed DB
    // queries against every watched id).
    if (!userId.startsWith("dev:")) {
      await this.presence.watchUser(userId);
      const linked = await this.accounts.listMine(userId);
      for (const a of linked) {
        await client.join(this.fanout.userRoomByAccount(a.id));
        await client.join(this.fanout.boardRoom(a.platform));
      }
    }

    this.logger.log(`connect ${client.id} user=${userId}`);
  }

  @SubscribeMessage(SocketEvents.PRESENCE_HEARTBEAT)
  async onHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    if (!userId?.startsWith("dev:")) {
      await this.presence.heartbeat(userId, {
        phase: payload?.phase as string | undefined,
        listingStatus: payload?.listingStatus as string | undefined,
        observedPuuid: payload?.observedPuuid as string | undefined,
        listingId: payload?.listingId as string | undefined,
      });
    }
    ack?.({ ok: true, serverStatus: (payload?.listingStatus as string) ?? undefined });
  }

  @SubscribeMessage(SocketEvents.LISTING_PUBLISH)
  async onPublish(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    await this.handleListingEvent(client, "publish", payload, ack);
  }

  @SubscribeMessage(SocketEvents.LISTING_PAUSE)
  async onPause(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    await this.handleListingEvent(client, "pause", payload, ack);
  }

  @SubscribeMessage(SocketEvents.LISTING_DELIST)
  async onDelist(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    await this.handleListingEvent(client, "delist", payload, ack);
  }

  @SubscribeMessage(SocketEvents.LISTING_READY)
  async onReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    await this.handleListingEvent(client, "ready", payload, ack);
  }

  @SubscribeMessage(SocketEvents.LISTING_REOPEN)
  async onReopen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    await this.handleListingEvent(client, "reopen", payload, ack);
  }

  @SubscribeMessage(SocketEvents.LISTING_RELIST)
  async onRelist(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    await this.handleListingEvent(client, "relist", payload, ack);
  }

  @SubscribeMessage(SocketEvents.SESSION_START)
  async onSessionStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    if (userId && !userId.startsWith("dev:")) {
      try {
        await this.sessions.onSessionStart(
          userId,
          payload?.listingId as string | undefined
        );
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : "fail" });
        return;
      }
    }
    ack?.({ ok: true, serverStatus: ListingStatus.IN_SESSION });
    this.emitAck(client, SocketEvents.SESSION_START, ListingStatus.IN_SESSION);
  }

  @SubscribeMessage(SocketEvents.SESSION_END)
  async onSessionEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    if (userId && !userId.startsWith("dev:")) {
      try {
        await this.sessions.onSessionEnd(userId, {
          listingId: payload?.listingId as string | undefined,
          observedPhase: payload?.observedPhase as string | undefined,
          final: payload?.final as boolean | undefined,
        });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : "fail" });
        return;
      }
    }
    ack?.({ ok: true, serverStatus: ListingStatus.POST_SESSION });
    this.emitAck(client, SocketEvents.SESSION_END, ListingStatus.POST_SESSION);
  }

  @SubscribeMessage(SocketEvents.LOBBY_CONFIRMED)
  async onLobbyConfirmed(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { joinRequestId?: string },
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    if (!payload?.joinRequestId || !userId || userId.startsWith("dev:")) {
      ack?.({ ok: false, error: "bad_payload" });
      return;
    }
    try {
      const result = await this.joins.confirmLobby(userId, payload.joinRequestId);
      ack?.({ ok: true, serverStatus: ListingStatus.READY });
      client.emit(SocketEvents.SYNC_ACK, {
        event: SocketEvents.LOBBY_CONFIRMED,
        ...result,
      });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : "fail" });
    }
  }

  @SubscribeMessage(SocketEvents.MEMBER_LEFT)
  async onMemberLeft(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { accountId?: string },
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    if (!payload?.accountId || !userId || userId.startsWith("dev:")) {
      ack?.({ ok: false, error: "bad_payload" });
      return;
    }
    try {
      await this.joins.memberLeft(userId, payload.accountId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : "fail" });
    }
  }

  @SubscribeMessage(SocketEvents.CHAT_SEND)
  async onChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId?: string; body?: string },
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    if (!payload?.sessionId || !payload.body || !userId || userId.startsWith("dev:")) {
      ack?.({ ok: false, error: "bad_payload" });
      return;
    }
    try {
      const msg = await this.sessions.sendChat(
        userId,
        payload.sessionId,
        payload.body
      );
      ack?.({ ok: true });
      client.emit(SocketEvents.SYNC_ACK, {
        event: SocketEvents.CHAT_SEND,
        ok: true,
        message: msg,
      });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : "fail" });
    }
  }

  @SubscribeMessage(SocketEvents.STATE_RECONCILE)
  async onReconcile(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Record<string, unknown>,
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    const listingId = payload?.listingId as string | undefined;
    if (listingId && userId && !userId.startsWith("dev:")) {
      try {
        const mine = await this.listings.mine(userId);
        if (mine) {
          client.emit(SocketEvents.LISTING_STATE, {
            listingId: mine.id,
            status: mine.status,
            reason: "reconcile",
          });
          ack?.({ ok: true, serverStatus: mine.status });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    ack?.({
      ok: true,
      serverStatus: (payload?.listingStatus as string) ?? undefined,
    });
  }

  private async handleListingEvent(
    client: Socket,
    event: "publish" | "pause" | "delist" | "ready" | "reopen" | "relist",
    payload: Record<string, unknown>,
    ack?: Ack
  ) {
    const userId = client.data.userId as string;
    const eventToState = {
      publish: "relist",
      pause: "pause",
      delist: "delist",
      ready: "ready",
      reopen: "reopen",
      relist: "relist",
    } as const;

    const listingId = payload?.listingId as string | undefined;
    let serverStatus =
      (payload?.status as string) ??
      ({
        publish: ListingStatus.LISTED,
        pause: ListingStatus.PAUSED,
        delist: ListingStatus.DELISTED,
        ready: ListingStatus.READY,
        reopen: ListingStatus.LISTED,
        relist: ListingStatus.LISTED,
      }[event]);

    if (listingId && userId && !userId.startsWith("dev:")) {
      try {
        const summary = await this.listings.applyState(userId, listingId, {
          event: eventToState[event],
          phase: payload?.phase as string | undefined,
        });
        serverStatus = summary.status;

        if (
          summary.status === ListingStatus.LISTED ||
          summary.status === ListingStatus.FILLING
        ) {
          await this.fanout.emitBoardUpsert(summary.platform, summary.queueId, {
            listing: summary,
          });
        } else {
          await this.fanout.emitBoardRemove(
            summary.platform,
            summary.queueId,
            summary.id
          );
        }

        client.emit(SocketEvents.LISTING_STATE, {
          listingId: summary.id,
          status: summary.status,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "state_failed";
        ack?.({ ok: false, error: msg });
        return;
      }
    }

    ack?.({ ok: true, serverStatus });
    this.emitAck(client, `listing.${event}`, serverStatus);
  }

  private emitAck(client: Socket, event: string, serverStatus: string) {
    client.emit(SocketEvents.SYNC_ACK, { event, ok: true, serverStatus });
  }
}
