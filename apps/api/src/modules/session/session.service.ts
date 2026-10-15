import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ArrayContains, In, IsNull, Not, Repository } from "typeorm";
import {
  ListingStatus,
  SocketEvents,
  type ChatMessagePayload,
  type SessionSummary,
} from "@lobly/shared-types";
import {
  ChatMessage,
  JoinRequest,
  Listing,
  RiotAccount,
  Session,
} from "../../database/entities";
import { BoardCacheService } from "../lobby/board-cache.service";
import { ListingsService } from "../lobby/listings.service";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";
import { ReputationService } from "../reputation/reputation.service";
import { MetricsService } from "../metrics/metrics.service";
import { ProfileService } from "../profile/profile.service";
import { JoinCleanupService } from "../join/join-cleanup.service";
import { replaceProfanity } from "../../common/profanity";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import type Redis from "ioredis";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(RiotAccount)
    private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(JoinRequest)
    private readonly joins: Repository<JoinRequest>,
    private readonly boardCache: BoardCacheService,
    private readonly listingsService: ListingsService,
    @Inject(forwardRef(() => RealtimeFanoutService))
    private readonly fanout: RealtimeFanoutService,
    private readonly reputation: ReputationService,
    private readonly metrics: MetricsService,
    private readonly profiles: ProfileService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => JoinCleanupService))
    private readonly joinCleanup: JoinCleanupService
  ) {}

  async createOrAttach(
    listing: Listing,
    memberAccountIds: string[]
  ): Promise<Session> {
    const existing = await this.sessions.findOne({
      where: { listingId: listing.id, endedAt: IsNull() },
    });
    if (existing) {
      const set = new Set([...existing.memberAccountIds, ...memberAccountIds]);
      existing.memberAccountIds = [...set];
      if (!existing.leagueLobbyConfirmedAt) {
        existing.leagueLobbyConfirmedAt = new Date();
      }
      return this.sessions.save(existing);
    }
    return this.sessions.save(
      this.sessions.create({
        listingId: listing.id,
        source: "LISTING",
        memberAccountIds: [...new Set(memberAccountIds)],
        leagueLobbyConfirmedAt: new Date(),
        gamesPlayed: 0,
        riotVerifiedGameIds: [],
      })
    );
  }

  async findActiveByJoin(jr: JoinRequest): Promise<Session | null> {
    return this.sessions.findOne({
      where: { listingId: jr.listingId, endedAt: IsNull() },
    });
  }

  async get(userId: string, sessionId: string) {
    const session = await this.requireMember(userId, sessionId);
    return this.toSummary(session);
  }

  async onSessionStart(userId: string, listingId?: string) {
    const session = await this.findActiveForUser(userId, listingId);
    if (!session) return { ok: true };
    if (!session.startedQueueAt) {
      session.startedQueueAt = new Date();
      await this.sessions.save(session);
    }
    const activeListingId = session.listingId;
    if (activeListingId) {
      const listing = await this.listings.findOne({
        where: { id: activeListingId },
      });
      if (listing) {
        listing.status = ListingStatus.IN_SESSION;
        await this.listings.save(listing);
        await this.boardCache.invalidate(listing.platform, listing.queueId);
        await this.fanout.emitBoardRemove(
          listing.platform,
          listing.queueId,
          listing.id
        );
        await this.fanout.emitListingState(listing.creatorAccountId, {
          listingId: listing.id,
          status: listing.status,
        });
      }
      await this.joinCleanup.closePendingForListing(
        activeListingId,
        "LOBBY_IN_GAME"
      );
    }
    return { ok: true, sessionId: session.id };
  }

  async onSessionEnd(
    userId: string,
    opts: { listingId?: string; final?: boolean; observedPhase?: string }
  ) {
    const session = await this.findActiveForUser(userId, opts.listingId);
    if (!session) return { ok: true };

    const final =
      opts.final === true ||
      opts.observedPhase === "None" ||
      opts.observedPhase === "Lobby";

    if (final && !session.endedAt) {
      session.endedAt = new Date();
      session.chatOpenUntil = new Date(Date.now() + 10 * 60 * 1000);
      await this.sessions.save(session);
      await this.fanout.emitToSession(session.id, SocketEvents.SESSION_ENDED, {
        sessionId: session.id,
        chatOpenUntil: session.chatOpenUntil.toISOString(),
      });

      for (const accountId of session.memberAccountIds) {
        await this.reputation.recordEvent(accountId, "COMPLETED", {
          sessionId: session.id,
        });
      }

      await this.metrics.log("session_completed", {
        sessionId: session.id,
        listingId: session.listingId ?? undefined,
      });

      // repeat_pair if these members completed before
      if (session.memberAccountIds.length >= 2) {
        const prior = await this.sessions
          .createQueryBuilder("s")
          .where("s.id != :id", { id: session.id })
          .andWhere("s.ended_at IS NOT NULL")
          .andWhere("s.member_account_ids @> :members", {
            members: session.memberAccountIds,
          })
          .getCount();
        if (prior > 0) {
          await this.metrics.log("repeat_pair", {
            sessionId: session.id,
            listingId: session.listingId ?? undefined,
          });
        }
      }

      const listing = session.listingId
        ? await this.listings.findOne({
            where: { id: session.listingId },
          })
        : null;
      if (listing) {
        listing.status = ListingStatus.POST_SESSION;
        await this.listings.save(listing);
        await this.fanout.emitListingState(listing.creatorAccountId, {
          listingId: listing.id,
          status: listing.status,
        });
      }
    } else {
      await this.sessions.save(session);
    }

    return { ok: true, sessionId: session.id, gamesPlayed: session.gamesPlayed };
  }

  /**
   * Count a Riot-confirmed game once. `riotVerifiedGameIds` is the set, so a
   * replayed game id does not increment gamesPlayed again.
   */
  async onGameEnded(session: Session, gameId: number): Promise<Session> {
    const current = (session.riotVerifiedGameIds ?? []).map((id) => String(id));
    const key = String(gameId);
    if (current.includes(key)) return session;
    session.riotVerifiedGameIds = [...current, key];
    session.gamesPlayed = (session.gamesPlayed ?? 0) + 1;
    return this.sessions.save(session);
  }

  async sendChat(userId: string, sessionId: string, body: string) {
    const session = await this.requireMember(userId, sessionId);
    this.assertChatOpen(session);

    const from = await this.memberAccountForUser(userId, session);
    if (!from) throw new ForbiddenException({ code: "NOT_MEMBER" });

    // Block check between all pairs is expensive; check vs other members
    for (const other of session.memberAccountIds) {
      if (other === from.id) continue;
      if (await this.reputation.isBlockedEitherWay(from.id, other)) {
        throw new ForbiddenException({ code: "BLOCKED" });
      }
    }

    const rateKey = `chat:${userId}`;
    const n = await this.redis.incr(rateKey);
    if (n === 1) await this.redis.expire(rateKey, 5);
    if (n > 5) throw new ForbiddenException({ code: "CHAT_RATE" });

    const cleaned = replaceProfanity((body ?? "").slice(0, 500));
    if (!cleaned.trim()) throw new ForbiddenException({ code: "EMPTY" });

    const msg = await this.messages.save(
      this.messages.create({
        sessionId,
        fromAccountId: from.id,
        body: cleaned,
      })
    );

    const payload = {
      id: Number(msg.id),
      sessionId,
      from: {
        accountId: from.id,
        riotId: from.riotId,
        tagLine: from.tagLine,
      },
      body: cleaned,
      at: msg.createdAt.toISOString(),
    };
    await this.fanout.emitToSession(sessionId, SocketEvents.CHAT_MESSAGE, payload);
    return payload;
  }

  async history(
    userId: string,
    sessionId: string
  ): Promise<ChatMessagePayload[]> {
    await this.requireMember(userId, sessionId);
    const rows = await this.messages.find({
      where: { sessionId },
      order: { createdAt: "DESC" },
      take: 100,
    });
    const ordered = rows.reverse();
    if (!ordered.length) return [];
    const accountIds = [...new Set(ordered.map((m) => m.fromAccountId))];
    const authors = await this.accounts.find({
      where: { id: In(accountIds) },
    });
    const byId = new Map(authors.map((a) => [a.id, a]));
    return ordered.map((m) => {
      const from = byId.get(m.fromAccountId);
      return {
        id: Number(m.id),
        sessionId: m.sessionId,
        from: {
          accountId: m.fromAccountId,
          riotId: from?.riotId ?? "",
          tagLine: from?.tagLine ?? "",
        },
        body: m.body,
        at: m.createdAt.toISOString(),
      };
    });
  }

  async purgeOldChat(): Promise<number> {
    const hours = Number(this.config.get("CHAT_TTL_HOURS") ?? 24 * 7);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await this.messages
      .createQueryBuilder()
      .delete()
      .where("created_at < :cutoff", { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Drop accountId from an open session on a listing this user created.
   * beforeQueue is true when the lobby had not started queue yet.
   */
  async detachOpenMember(
    creatorUserId: string,
    accountId: string
  ): Promise<{ listingId: string; beforeQueue: boolean } | null> {
    const mine = await this.accounts.find({ where: { userId: creatorUserId } });
    if (!mine.length) return null;
    const owned = await this.listings.find({
      where: { creatorAccountId: In(mine.map((a) => a.id)) },
    });
    for (const listing of owned) {
      const session = await this.sessions.findOne({
        where: { listingId: listing.id, endedAt: IsNull() },
      });
      if (!session || !session.memberAccountIds.includes(accountId)) continue;
      const beforeQueue = session.startedQueueAt == null;
      session.memberAccountIds = session.memberAccountIds.filter(
        (id) => id !== accountId
      );
      await this.sessions.save(session);
      return { listingId: listing.id, beforeQueue };
    }
    return null;
  }

  /**
   * End abandoned open sessions. Does not record COMPLETED or prompt endorsements.
   */
  async sweepIdleSessions(now = new Date()): Promise<number> {
    const open = await this.sessions.find({ where: { endedAt: IsNull() } });
    const sixHours = 6 * 60 * 60 * 1000;
    const idleAfter = 30 * 60 * 1000;
    let ended = 0;
    for (const session of open) {
      const created = session.createdAt.getTime();
      const tooOld = created < now.getTime() - sixHours;
      if (!tooOld) {
        const last = Math.max(
          session.startedQueueAt?.getTime() ?? 0,
          session.leagueLobbyConfirmedAt?.getTime() ?? 0,
          created
        );
        if (last >= now.getTime() - idleAfter) continue;
        if (!(await this.nobodyPresent(session.memberAccountIds))) continue;
      }
      session.endedAt = new Date(now.getTime());
      session.chatOpenUntil = new Date(now.getTime());
      await this.sessions.save(session);
      ended++;
    }
    return ended;
  }

  private async nobodyPresent(accountIds: string[]): Promise<boolean> {
    if (!accountIds.length) return true;
    const accounts = await this.accounts.find({
      where: { id: In(accountIds) },
    });
    const userIds = [...new Set(accounts.map((a) => a.userId))];
    if (!userIds.length) return true;
    for (const userId of userIds) {
      const present = await this.redis.exists(`presence:${userId}`);
      if (present) return false;
    }
    return true;
  }

  private assertChatOpen(session: Session) {
    const until = session.chatOpenUntil;
    if (session.endedAt && until && until.getTime() < Date.now()) {
      throw new ForbiddenException({ code: "CHAT_CLOSED" });
    }
    // open from join.accepted (session exists) until chat_open_until after end
    if (session.endedAt && !until) {
      throw new ForbiddenException({ code: "CHAT_CLOSED" });
    }
  }

  private async requireMember(userId: string, sessionId: string) {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException({ code: "NOT_FOUND" });
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.some((a) => session.memberAccountIds.includes(a.id))) {
      throw new ForbiddenException({ code: "NOT_MEMBER" });
    }
    return session;
  }

  private async memberAccountForUser(userId: string, session: Session) {
    const mine = await this.accounts.find({ where: { userId } });
    return mine.find((a) => session.memberAccountIds.includes(a.id)) ?? null;
  }

  private async findActiveForUser(userId: string, listingId?: string) {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) return null;
    const ids = mine.map((a) => a.id);

    if (listingId) {
      const session = await this.sessions.findOne({
        where: { listingId, endedAt: IsNull() },
      });
      if (!session) return null;
      const member = session.memberAccountIds.some((id) => ids.includes(id));
      return member ? session : null;
    }

    // Find any open session containing one of my accounts
    for (const id of ids) {
      const s = await this.sessions.findOne({
        where: {
          endedAt: IsNull(),
          memberAccountIds: ArrayContains([id]),
        },
      });
      if (s) return s;
    }
    // Also allow recently ended within chat window
    for (const id of ids) {
      const s = await this.sessions.findOne({
        where: {
          endedAt: Not(IsNull()),
          memberAccountIds: ArrayContains([id]),
        },
        order: { endedAt: "DESC" },
      });
      if (s && s.chatOpenUntil && s.chatOpenUntil.getTime() > Date.now()) {
        return s;
      }
    }
    return null;
  }

  /**
   * Open session, or a recently ended one still inside the chat window.
   * SessionSummary fields plus sessionId/chatOpen for SESSION_ACTIVE reconcile.
   */
  async findActiveSummaryForUser(
    userId: string
  ): Promise<(SessionSummary & { sessionId: string; chatOpen: boolean }) | null> {
    const session = await this.findActiveForUser(userId);
    if (!session) return null;
    const chatOpen =
      !session.endedAt ||
      (session.chatOpenUntil != null &&
        session.chatOpenUntil.getTime() > Date.now());
    return {
      ...this.toSummary(session),
      sessionId: session.id,
      chatOpen,
    };
  }

  private toSummary(session: Session) {
    return {
      id: session.id,
      listingId: session.listingId,
      memberAccountIds: session.memberAccountIds,
      leagueLobbyConfirmedAt:
        session.leagueLobbyConfirmedAt?.toISOString() ?? null,
      startedQueueAt: session.startedQueueAt?.toISOString() ?? null,
      gamesPlayed: session.gamesPlayed,
      endedAt: session.endedAt?.toISOString() ?? null,
      chatOpenUntil: session.chatOpenUntil?.toISOString() ?? null,
    };
  }
}
