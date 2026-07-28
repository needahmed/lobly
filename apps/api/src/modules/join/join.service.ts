import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import { Inject } from "@nestjs/common";
import { Queue } from "bullmq";
import { DataSource, In, Repository } from "typeorm";
import type Redis from "ioredis";
import { BLOCKED_PLATFORMS } from "@lobly/riot-client";
import {
  ListingStatus,
  SocketEvents,
  normalizeSlots,
  slotAcceptsRole,
  type Role,
} from "@lobly/shared-types";
import {
  JoinRequest,
  Listing,
  RiotAccount,
  UserPrefs,
} from "../../database/entities";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import { ProfileService } from "../profile/profile.service";
import { evaluateEligibility } from "../lobby/eligibility";
import { matchScore } from "../lobby/match-score";
import { BoardCacheService } from "../lobby/board-cache.service";
import { ListingsService } from "../lobby/listings.service";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";
import { ReputationService } from "../reputation/reputation.service";
import { MetricsService } from "../metrics/metrics.service";
import { SessionService } from "../session/session.service";

export const JOIN_QUEUE = "join-timeouts";

@Injectable()
export class JoinService {
  constructor(
    @InjectRepository(JoinRequest)
    private readonly joins: Repository<JoinRequest>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(RiotAccount)
    private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(UserPrefs)
    private readonly prefsRepo: Repository<UserPrefs>,
    @InjectQueue(JOIN_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dataSource: DataSource,
    private readonly profiles: ProfileService,
    private readonly boardCache: BoardCacheService,
    private readonly listingsService: ListingsService,
    private readonly fanout: RealtimeFanoutService,
    private readonly reputation: ReputationService,
    private readonly metrics: MetricsService,
    private readonly sessions: SessionService
  ) {}

  async requestJoin(
    userId: string,
    listingId: string,
    roleSlot?: string,
    idempotencyKey?: string
  ) {
    if (idempotencyKey) {
      const cached = await this.redis.get(
        `idem:join:${userId}:${idempotencyKey}`
      );
      if (cached) return JSON.parse(cached);
    }

    await this.reputation.assertUserCanListOrJoin(userId);

    const hourKey = `joinrate:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    const rate = await this.redis.incr(hourKey);
    if (rate === 1) await this.redis.expire(hourKey, 3600);
    if (rate > 10) throw new BadRequestException({ code: "JOIN_THROTTLE" });

    const listing = await this.listings.findOne({ where: { id: listingId } });
    if (!listing) throw new NotFoundException({ code: "NOT_FOUND" });
    if (
      listing.status !== ListingStatus.LISTED &&
      listing.status !== ListingStatus.FILLING
    ) {
      throw new BadRequestException({ code: "LISTING_NOT_OPEN" });
    }

    const requester = await this.resolveAccount(userId);
    if (BLOCKED_PLATFORMS.has(requester.platform)) {
      throw new ForbiddenException({ code: "REGION_NOT_SUPPORTED" });
    }
    if (requester.id === listing.creatorAccountId) {
      throw new BadRequestException({ code: "CANNOT_JOIN_OWN" });
    }

    const pending = await this.joins.findOne({
      where: {
        listingId,
        requesterAccountId: requester.id,
        status: "PENDING",
      },
    });
    if (pending) throw new BadRequestException({ code: "ALREADY_PENDING" });

    if (
      await this.reputation.isBlockedEitherWay(
        listing.creatorAccountId,
        requester.id
      )
    ) {
      throw new ForbiddenException({
        code: "INELIGIBLE",
        reasons: ["BLOCKED"],
      });
    }

    await this.profiles.ensureFresh(requester.id, "join_request");
    const snap = await this.profiles.getSnapshotEntity(requester.id);
    const creatorSnap = await this.profiles.getSnapshotEntity(
      listing.creatorAccountId
    );
    if (!snap || !creatorSnap) {
      throw new BadRequestException({ code: "NO_SNAPSHOT" });
    }

    const prefs = await this.prefsDto(userId);
    const reliability = await this.reputation.getReliability(requester.id);
    const elig = evaluateEligibility(
      listing,
      {
        platform: requester.platform,
        soloTier: snap.soloTier,
        soloDivision: snap.soloDivision,
        flexTier: snap.flexTier,
        flexDivision: snap.flexDivision,
        primaryRole: snap.primaryRole as Role | null,
        secondaryRole: snap.secondaryRole as Role | null,
        gamesThisSeason: snap.gamesThisSeason,
      },
      prefs,
      {
        soloTier: creatorSnap.soloTier,
        soloDivision: creatorSnap.soloDivision,
      },
      (roleSlot as Role) ?? null,
      { blocked: false, reliability }
    );

    if (!elig.eligible) {
      throw new ForbiddenException({
        code: "INELIGIBLE",
        reasons: elig.reasons,
      });
    }

    const score = matchScore(
      listing,
      {
        soloTier: creatorSnap.soloTier,
        soloDivision: creatorSnap.soloDivision,
        flexTier: creatorSnap.flexTier,
        flexDivision: creatorSnap.flexDivision,
        primaryRole: creatorSnap.primaryRole as Role | null,
        secondaryRole: creatorSnap.secondaryRole as Role | null,
      },
      {
        soloTier: snap.soloTier,
        soloDivision: snap.soloDivision,
        flexTier: snap.flexTier,
        flexDivision: snap.flexDivision,
        primaryRole: snap.primaryRole as Role | null,
        secondaryRole: snap.secondaryRole as Role | null,
      },
      prefs
    );

    const row = await this.joins.save(
      this.joins.create({
        listingId,
        requesterAccountId: requester.id,
        roleSlot: roleSlot ?? null,
        status: "PENDING",
        matchScore: score,
        offRole: elig.offRole,
      })
    );

    const card = await this.profiles.getCard(requester.id);
    const creator = await this.accounts.findOne({
      where: { id: listing.creatorAccountId },
    });

    await this.metrics.log("join_requested", {
      accountId: requester.id,
      listingId,
      joinRequestId: row.id,
    });

    if (creator) {
      await this.fanout.emitToUser(creator.userId, SocketEvents.JOIN_REQUESTED, {
        joinRequestId: row.id,
        card,
        matchScore: score,
        offRole: elig.offRole,
        roleSlot: row.roleSlot,
      });
    }

    const result = {
      joinRequestId: row.id,
      matchScore: score,
      offRole: elig.offRole,
    };
    if (idempotencyKey) {
      await this.redis.setex(
        `idem:join:${userId}:${idempotencyKey}`,
        600,
        JSON.stringify(result)
      );
    }
    return result;
  }

  async accept(userId: string, joinRequestId: string) {
    const jr = await this.joins.findOne({ where: { id: joinRequestId } });
    if (!jr) throw new NotFoundException({ code: "NOT_FOUND" });
    if (jr.status !== "PENDING") {
      throw new BadRequestException({ code: "NOT_PENDING" });
    }

    const listing = await this.listings.findOne({
      where: { id: jr.listingId },
      relations: { creatorAccount: true },
    });
    if (!listing) throw new NotFoundException({ code: "LISTING_GONE" });
    if (listing.creatorAccount.userId !== userId) {
      throw new ForbiddenException({ code: "NOT_OWNER" });
    }

    await this.profiles.ensureFresh(jr.requesterAccountId, "join_request");

    const invitee = await this.accounts.findOne({
      where: { id: jr.requesterAccountId },
    });
    if (!invitee || invitee.summonerId == null) {
      throw new BadRequestException({ code: "INVITEE_NO_SUMMONER_ID" });
    }

    await this.dataSource.transaction(async (manager) => {
      jr.status = "ACCEPTED";
      jr.decidedAt = new Date();
      await manager.save(jr);

      listing.status = ListingStatus.FILLING;
      const slots = normalizeSlots(listing.slots);
      const wanted = jr.roleSlot as Role | null;
      const idx = wanted
        ? slots.findIndex((s) => s.open && slotAcceptsRole(s.roles, wanted))
        : slots.findIndex((s) => s.open);
      if (idx >= 0) {
        slots[idx] = {
          ...slots[idx],
          open: false,
          pendingAccountId: jr.requesterAccountId,
        };
        listing.slots = slots;
      }
      await manager.save(listing);
    });

    await this.reputation.recordEvent(jr.requesterAccountId, "ACCEPTED", {
      joinRequestId: jr.id,
    });
    await this.metrics.log("join_accepted", {
      accountId: jr.requesterAccountId,
      listingId: listing.id,
      joinRequestId: jr.id,
    });
    await this.boardCache.invalidate(listing.platform, listing.queueId);

    const expiresAt = new Date(Date.now() + 90_000);
    await this.queue.add(
      "timeout",
      { joinRequestId: jr.id },
      { delay: 90_000, jobId: `join-timeout-${jr.id}`, removeOnComplete: true }
    );

    const creator = listing.creatorAccount;
    await this.fanout.emitToUser(creator.userId, SocketEvents.JOIN_ACCEPTED, {
      joinRequestId: jr.id,
      invitee: {
        summonerId: Number(invitee.summonerId),
        riotId: invitee.riotId,
        tagLine: invitee.tagLine,
        accountId: invitee.id,
      },
    });
    await this.fanout.emitToUser(invitee.userId, SocketEvents.JOIN_ACCEPTED, {
      joinRequestId: jr.id,
      listingId: listing.id,
      creator: {
        riotId: creator.riotId,
        tagLine: creator.tagLine,
        summonerId: Number(creator.summonerId ?? 0),
      },
      autoAcceptEligible: true,
    });

    await this.fanout.emitBoardUpsert(listing.platform, listing.queueId, {
      listing: this.listingsService.toSummary(listing),
    });
    await this.fanout.emitListingState(listing.creatorAccountId, {
      listingId: listing.id,
      status: listing.status,
    });

    return { ok: true, expiresAt: expiresAt.toISOString() };
  }

  async decline(userId: string, joinRequestId: string) {
    const jr = await this.joins.findOne({ where: { id: joinRequestId } });
    if (!jr) throw new NotFoundException({ code: "NOT_FOUND" });
    if (jr.status !== "PENDING") {
      throw new BadRequestException({ code: "NOT_PENDING" });
    }
    const listing = await this.listings.findOne({
      where: { id: jr.listingId },
      relations: { creatorAccount: true },
    });
    if (!listing || listing.creatorAccount.userId !== userId) {
      throw new ForbiddenException({ code: "NOT_OWNER" });
    }

    jr.status = "DECLINED";
    jr.decidedAt = new Date();
    await this.joins.save(jr);

    const requester = await this.accounts.findOne({
      where: { id: jr.requesterAccountId },
    });
    if (requester) {
      await this.fanout.emitToUser(requester.userId, SocketEvents.JOIN_DECLINED, {
        joinRequestId: jr.id,
      });
    }
    return { ok: true };
  }

  async inviteResult(
    userId: string,
    joinRequestId: string,
    body: { ok: boolean; error?: string }
  ) {
    const jr = await this.joins.findOne({ where: { id: joinRequestId } });
    if (!jr || jr.status !== "ACCEPTED") {
      throw new BadRequestException({ code: "NOT_ACCEPTED" });
    }
    const listing = await this.listings.findOne({
      where: { id: jr.listingId },
      relations: { creatorAccount: true },
    });
    if (!listing || listing.creatorAccount.userId !== userId) {
      throw new ForbiddenException({ code: "NOT_OWNER" });
    }
    if (body.ok) return { ok: true };
    await this.failJoin(jr, listing, "INVITE_FAILED");
    return { ok: true, reopened: true };
  }

  async cancel(userId: string, joinRequestId: string) {
    const jr = await this.joins.findOne({ where: { id: joinRequestId } });
    if (!jr) throw new NotFoundException({ code: "NOT_FOUND" });
    const requester = await this.accounts.findOne({
      where: { id: jr.requesterAccountId, userId },
    });
    if (!requester) throw new ForbiddenException({ code: "NOT_REQUESTER" });
    if (jr.status !== "PENDING") {
      throw new BadRequestException({ code: "NOT_PENDING" });
    }
    jr.status = "CANCELLED";
    jr.decidedAt = new Date();
    await this.joins.save(jr);
    return { ok: true };
  }

  async listForListing(userId: string, listingId: string) {
    const listing = await this.listings.findOne({
      where: { id: listingId },
      relations: { creatorAccount: true },
    });
    if (!listing || listing.creatorAccount.userId !== userId) {
      throw new ForbiddenException({ code: "NOT_OWNER" });
    }
    const rows = await this.joins.find({
      where: { listingId },
      order: { createdAt: "DESC" },
      take: 50,
    });
    const out = [];
    for (const r of rows) {
      const card = await this.profiles.getCard(r.requesterAccountId);
      out.push({
        id: r.id,
        status: r.status,
        roleSlot: r.roleSlot,
        matchScore: r.matchScore,
        offRole: r.offRole,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        card,
      });
    }
    return out;
  }

  async confirmLobby(userId: string, joinRequestId: string) {
    const jr = await this.joins.findOne({ where: { id: joinRequestId } });
    if (!jr) throw new NotFoundException({ code: "NOT_FOUND" });
    if (jr.status === "COMPLETED") {
      const existing = await this.sessions.findActiveByJoin(jr);
      return { ok: true, sessionId: existing?.id, duplicate: true };
    }
    if (jr.status !== "ACCEPTED") {
      throw new BadRequestException({ code: "NOT_ACCEPTED" });
    }

    const listing = await this.listings.findOne({
      where: { id: jr.listingId },
      relations: { creatorAccount: true },
    });
    if (!listing) throw new NotFoundException({ code: "LISTING_GONE" });

    const accounts = await this.accounts.find({ where: { userId } });
    const allowed = accounts.some(
      (a) =>
        a.id === listing.creatorAccountId || a.id === jr.requesterAccountId
    );
    if (!allowed) throw new ForbiddenException({ code: "NOT_PARTY" });

    try {
      await this.queue.remove(`join-timeout-${jr.id}`);
    } catch {
      /* ignore */
    }

    jr.status = "COMPLETED";
    jr.decidedAt = jr.decidedAt ?? new Date();
    await this.joins.save(jr);

    const slots = normalizeSlots(listing.slots).map((s) =>
      s.pendingAccountId === jr.requesterAccountId
        ? { ...s, open: false, pendingAccountId: null }
        : s
    );
    const openLeft = slots.some((s) => s.open);
    listing.status = openLeft ? ListingStatus.FILLING : ListingStatus.READY;
    listing.slots = slots;
    await this.listings.save(listing);
    await this.boardCache.invalidate(listing.platform, listing.queueId);

    await this.reputation.recordEvent(jr.requesterAccountId, "SHOWED", {
      joinRequestId: jr.id,
    });

    const session = await this.sessions.createOrAttach(listing, [
      listing.creatorAccountId,
      jr.requesterAccountId,
    ]);

    const acceptedAt = jr.decidedAt?.getTime() ?? Date.now();
    await this.metrics.log("lobby_confirmed", {
      accountId: jr.requesterAccountId,
      listingId: listing.id,
      sessionId: session.id,
      joinRequestId: jr.id,
      meta: { msToConfirm: Date.now() - acceptedAt },
    });

    const creator = listing.creatorAccount;
    const invitee = await this.accounts.findOne({
      where: { id: jr.requesterAccountId },
    });

    for (const acc of [creator, invitee].filter(Boolean) as RiotAccount[]) {
      await this.fanout.emitToUser(acc.userId, SocketEvents.SESSION_ACTIVE, {
        sessionId: session.id,
        memberAccountIds: session.memberAccountIds,
        chatOpen: true,
      });
      await this.fanout.joinSessionRoom(acc.userId, session.id);
    }

    await this.fanout.emitListingState(listing.creatorAccountId, {
      listingId: listing.id,
      status: listing.status,
    });

    return { ok: true, sessionId: session.id };
  }

  async handleTimeout(joinRequestId: string) {
    const jr = await this.joins.findOne({ where: { id: joinRequestId } });
    if (!jr || jr.status !== "ACCEPTED") return;

    const listing = await this.listings.findOne({
      where: { id: jr.listingId },
      relations: { creatorAccount: true },
    });
    if (!listing) return;

    jr.status = "NO_SHOW";
    jr.decidedAt = new Date();
    await this.joins.save(jr);

    await this.reputation.recordEvent(jr.requesterAccountId, "NO_SHOW", {
      joinRequestId: jr.id,
    });
    await this.metrics.log("no_show", {
      accountId: jr.requesterAccountId,
      listingId: listing.id,
      joinRequestId: jr.id,
    });

    await this.reopenSlot(listing, jr.requesterAccountId);

    const requester = await this.accounts.findOne({
      where: { id: jr.requesterAccountId },
    });
    if (listing.creatorAccount) {
      await this.fanout.emitToUser(
        listing.creatorAccount.userId,
        SocketEvents.JOIN_REOPENED,
        { listingId: listing.id, joinRequestId: jr.id }
      );
    }
    if (requester) {
      await this.fanout.emitToUser(requester.userId, SocketEvents.JOIN_FAILED, {
        joinRequestId: jr.id,
        code: "NO_SHOW",
      });
    }
  }

  async memberLeft(userId: string, accountId: string) {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) return { ok: true };

    const row = await this.listings.findOne({
      where: {
        creatorAccountId: In(mine.map((a) => a.id)),
        status: ListingStatus.READY,
      },
    });
    if (!row) return { ok: true };

    await this.reputation.recordEvent(accountId, "ABANDONED");
    await this.reopenSlot(row, accountId);
    await this.fanout.emitToUser(userId, SocketEvents.JOIN_REOPENED, {
      listingId: row.id,
    });
    return { ok: true };
  }

  private async failJoin(jr: JoinRequest, listing: Listing, code: string) {
    jr.status = "EXPIRED";
    jr.decidedAt = new Date();
    await this.joins.save(jr);
    try {
      await this.queue.remove(`join-timeout-${jr.id}`);
    } catch {
      /* ignore */
    }
    await this.reopenSlot(listing, jr.requesterAccountId);

    const requester = await this.accounts.findOne({
      where: { id: jr.requesterAccountId },
    });
    const creator =
      listing.creatorAccount ??
      (await this.accounts.findOne({ where: { id: listing.creatorAccountId } }));
    if (creator) {
      await this.fanout.emitToUser(creator.userId, SocketEvents.JOIN_REOPENED, {
        listingId: listing.id,
        joinRequestId: jr.id,
      });
    }
    if (requester) {
      await this.fanout.emitToUser(requester.userId, SocketEvents.JOIN_FAILED, {
        joinRequestId: jr.id,
        code,
      });
    }
  }

  private async reopenSlot(listing: Listing, pendingAccountId: string) {
    listing.slots = normalizeSlots(listing.slots).map((s) =>
      s.pendingAccountId === pendingAccountId
        ? { ...s, open: true, pendingAccountId: null }
        : s
    );

    const anyPending = await this.joins.findOne({
      where: { listingId: listing.id, status: "ACCEPTED" },
    });
    listing.status = anyPending ? ListingStatus.FILLING : ListingStatus.LISTED;
    await this.listings.save(listing);
    await this.boardCache.invalidate(listing.platform, listing.queueId);
    await this.fanout.emitBoardUpsert(listing.platform, listing.queueId, {
      listing: this.listingsService.toSummary(listing),
    });
    await this.fanout.emitListingState(listing.creatorAccountId, {
      listingId: listing.id,
      status: listing.status,
    });
  }

  private async resolveAccount(userId: string): Promise<RiotAccount> {
    const accounts = await this.accounts.find({
      where: { userId },
      order: { lastSeenAt: "DESC" },
    });
    if (!accounts.length) {
      throw new BadRequestException({ code: "NO_RIOT_ACCOUNT" });
    }
    return accounts[0];
  }

  private async prefsDto(userId: string) {
    const prefsRow = await this.prefsRepo.findOne({ where: { userId } });
    if (!prefsRow) return null;
    return {
      languages: prefsRow.languages ?? [],
      voice: prefsRow.voice,
      vibeTags: prefsRow.vibeTags ?? [],
      discordTag: prefsRow.discordTag,
      discordReveal: prefsRow.discordReveal,
      autoAcceptLoblyInvites: prefsRow.autoAcceptLoblyInvites,
    };
  }
}
