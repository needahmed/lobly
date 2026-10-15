import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Not, Repository } from "typeorm";
import type Redis from "ioredis";
import { BLOCKED_PLATFORMS } from "@lobly/riot-client";
import {
  ACTIVE_LISTING_STATUSES,
  ListingStatus,
  isPublishableQueue,
  listingTypeFromCapability,
  normalizeListingType,
  normalizeSlots,
  newSlotId,
  queueMetaFromQueueId,
  type ListingFilters,
  type ListingParty,
  type ListingPartyMember,
  type ListingQueueMeta,
  type ListingSlot,
  type ListingSummary,
  type Role,
} from "@lobly/shared-types";
import { JoinRequest, Listing, RiotAccount, User } from "../../database/entities";
import { containsProfanity } from "../../common/profanity";
import { ProfileService } from "../profile/profile.service";
import { CreateListingDto, ListingStateDto, PatchListingDto } from "./dto/listing.dto";
import { BoardCacheService } from "./board-cache.service";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import { MetricsService } from "../metrics/metrics.service";

const EVENT_TO_STATUS: Record<ListingStateDto["event"], ListingStatus> = {
  pause: ListingStatus.PAUSED,
  relist: ListingStatus.LISTED,
  delist: ListingStatus.DELISTED,
  ready: ListingStatus.READY,
  reopen: ListingStatus.LISTED,
};

const ROLES = new Set<Role>(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);

/** Pause written by reconcileParty when the League lobby has no free seats. */
const LOBBY_FULL_PAUSE = "LOBBY_FULL";

interface PartyConfirm {
  confirmLobbyFromParty(listing: Listing, memberAccountIds: string[]): Promise<void>;
}

function joinServiceToken(): abstract new (...args: never[]) => PartyConfirm {
  return require("../join/join.service").JoinService;
}

const RELIST_TTL_MS = 30 * 60 * 1000;

interface BoardFanout {
  emitBoardUpsert(
    platform: string,
    queueId: number | undefined,
    row: unknown
  ): Promise<void>;
  emitBoardRemove?(
    platform: string,
    queueId: number | undefined,
    listingId: string
  ): Promise<void>;
  emitListingState?(
    creatorAccountId: string,
    payload: { listingId: string; status: string; reason?: string }
  ): Promise<void>;
}

function boardFanoutToken(): abstract new (...args: never[]) => BoardFanout {
  // Lazy so this module does not import the gateway graph at load time.
  return require("../realtime/realtime-fanout.service").RealtimeFanoutService;
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly profiles: ProfileService,
    private readonly boardCache: BoardCacheService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(forwardRef(() => boardFanoutToken()))
    private readonly fanout: BoardFanout,
    private readonly events: EventEmitter2,
    @Optional() private readonly metrics?: MetricsService,
    @Optional()
    @InjectRepository(JoinRequest)
    private readonly joinRequests?: Repository<JoinRequest>,
    @Optional()
    @Inject(forwardRef(() => joinServiceToken()))
    private readonly partyJoins?: PartyConfirm
  ) {}

  async create(
    userId: string,
    dto: CreateListingDto,
    idempotencyKey?: string
  ): Promise<ListingSummary> {
    if (idempotencyKey) {
      const cached = await this.redis.get(`idem:listing:${userId}:${idempotencyKey}`);
      if (cached) return JSON.parse(cached);
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.banned) {
      throw new ForbiddenException({ code: "ACCOUNT_BANNED" });
    }
    if (
      user.listingBannedUntil &&
      user.listingBannedUntil.getTime() > Date.now()
    ) {
      throw new ForbiddenException({
        code: "LISTING_BANNED",
        until: user.listingBannedUntil.toISOString(),
      });
    }

    const account = await this.accounts.findOne({
      where: { id: dto.riotAccountId, userId },
    });
    if (!account) throw new ForbiddenException({ code: "ACCOUNT_NOT_YOURS" });
    if (!account.verifiedAt) {
      throw new BadRequestException({ code: "NOT_VERIFIED" });
    }
    if (BLOCKED_PLATFORMS.has(account.platform)) {
      throw new ForbiddenException({ code: "REGION_NOT_SUPPORTED" });
    }
    if (
      !account.lastSeenAt ||
      Date.now() - account.lastSeenAt.getTime() > 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException({
        code: "STALE_PRESENCE",
        message: "Riot account must be seen logged in within 24h",
      });
    }
    if (!isPublishableQueue(dto.queueId)) {
      throw new BadRequestException({ code: "INVALID_QUEUE" });
    }
    if (containsProfanity(dto.title) || (dto.description && containsProfanity(dto.description))) {
      throw new BadRequestException({ code: "PROFANITY" });
    }

    const queueMeta = this.resolveQueueMeta(dto);
    const type =
      dto.type === "POSITIONAL" || dto.type === "OPEN"
        ? dto.type
        : listingTypeFromCapability({
            ...queueMeta,
            freeSeats: queueMeta.maxLobbySize,
            memberCount: 0,
          });
    const slots = this.normalizeAndValidateSlots(dto.slots, queueMeta);
    const filters = (dto.filters ?? {}) as ListingFilters;

    // Reject duplicates before the (potentially slow) profile refresh so the
    // client gets its error immediately.
    const existing = await this.listings.findOne({
      where: {
        creatorAccountId: account.id,
        status: In([...ACTIVE_LISTING_STATUSES]),
      },
    });
    if (existing) {
      throw new BadRequestException({
        code: "ACTIVE_LISTING_EXISTS",
        message: "Max one active listing per Riot account",
      });
    }

    await this.profiles.ensureFresh(account.id, "publishing");

    const expiresAt = new Date(Date.now() + dto.durationMin * 60 * 1000);
    const row = await this.listings.save(
      this.listings.create({
        creatorAccountId: account.id,
        platform: account.platform,
        queueId: dto.queueId,
        type,
        title: dto.title,
        description: dto.description ?? null,
        status: ListingStatus.LISTED,
        filters,
        slots,
        queueMeta,
        voiceRequired: dto.voiceRequired,
        languages: dto.languages ?? [],
        expiresAt,
      })
    );

    await this.boardCache.invalidate(row.platform);
    const summary = this.toSummary(row);
    await this.metrics?.log("listing_published", {
      accountId: account.id,
      listingId: row.id,
    });
    if (idempotencyKey) {
      await this.redis.setex(
        `idem:listing:${userId}:${idempotencyKey}`,
        600,
        JSON.stringify(summary)
      );
    }
    return summary;
  }

  async patch(
    userId: string,
    id: string,
    dto: PatchListingDto
  ): Promise<ListingSummary> {
    const row = await this.requireOwned(userId, id);
    if (
      row.status !== ListingStatus.LISTED &&
      row.status !== ListingStatus.FILLING &&
      row.status !== ListingStatus.PAUSED
    ) {
      throw new BadRequestException({ code: "LISTING_CLOSED" });
    }
    if (dto.title !== undefined) {
      if (containsProfanity(dto.title)) {
        throw new BadRequestException({ code: "PROFANITY" });
      }
      row.title = dto.title;
    }
    if (dto.description !== undefined) {
      if (dto.description && containsProfanity(dto.description)) {
        throw new BadRequestException({ code: "PROFANITY" });
      }
      row.description = dto.description;
    }
    if (dto.filters !== undefined) row.filters = dto.filters as ListingFilters;
    if (dto.slots !== undefined) {
      row.slots = this.normalizeAndValidateSlots(
        dto.slots,
        row.queueMeta ?? queueMetaFromQueueId(row.queueId),
        row.slots
      );
    }
    if (dto.voiceRequired !== undefined) row.voiceRequired = dto.voiceRequired;
    if (dto.languages !== undefined) row.languages = dto.languages;
    if (dto.durationMin !== undefined) {
      row.expiresAt = new Date(Date.now() + dto.durationMin * 60 * 1000);
    }
    const saved = await this.listings.save(row);
    await this.boardCache.invalidate(saved.platform);
    const summary = this.toSummary(saved);
    await this.fanout.emitBoardUpsert(saved.platform, saved.queueId, {
      listing: summary,
    });
    return summary;
  }

  async applyState(
    userId: string,
    id: string,
    dto: ListingStateDto
  ): Promise<ListingSummary> {
    const row = await this.requireOwned(userId, id);
    return this.applyStateInternal(row, dto.event, dto.phase);
  }

  async applyStateByAccount(
    creatorAccountId: string,
    event: ListingStateDto["event"],
    phase?: string
  ): Promise<ListingSummary | null> {
    const row = await this.listings.findOne({
      where: {
        creatorAccountId,
        status: In([...ACTIVE_LISTING_STATUSES]),
      },
    });
    if (!row) return null;
    return this.applyStateInternal(row, event, phase);
  }

  async applyStateInternal(
    row: Listing,
    event: ListingStateDto["event"],
    phase?: string
  ): Promise<ListingSummary> {
    const forcePause =
      !!phase &&
      ["ChampSelect", "GameStart", "InProgress"].includes(phase) &&
      event !== "delist";
    const effective: ListingStateDto["event"] = forcePause ? "pause" : event;
    this.assertTransition(row, effective);

    if (effective === "relist") {
      const other = await this.listings.findOne({
        where: {
          creatorAccountId: row.creatorAccountId,
          status: In([...ACTIVE_LISTING_STATUSES]),
          id: Not(row.id),
        },
      });
      if (other) {
        throw new ConflictException({ code: "ACTIVE_LISTING_EXISTS" });
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        row.expiresAt = new Date(Date.now() + RELIST_TTL_MS);
      }
    }

    const next = EVENT_TO_STATUS[effective];
    row.status = next;
    if (next === ListingStatus.PAUSED) {
      row.pausedAt = new Date();
      row.pauseReason = null;
    }
    if (next === ListingStatus.DELISTED) row.delistedAt = new Date();
    if (next === ListingStatus.LISTED) {
      row.pausedAt = null;
      row.delistedAt = null;
      row.pauseReason = null;
    }

    let saved: Listing;
    try {
      saved = await this.listings.save(row);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new ConflictException({ code: "ACTIVE_LISTING_EXISTS" });
      }
      throw err;
    }
    await this.boardCache.invalidate(saved.platform);
    if (saved.status === ListingStatus.DELISTED) {
      this.emitListingClosed(saved.id, "DELISTED");
    }
    return this.toSummary(saved);
  }

  async mine(userId: string): Promise<ListingSummary | null> {
    const accounts = await this.accounts.find({ where: { userId } });
    if (!accounts.length) return null;
    const row = await this.listings.findOne({
      where: {
        creatorAccountId: In(accounts.map((a) => a.id)),
        status: In([...ACTIVE_LISTING_STATUSES]),
      },
      order: { createdAt: "DESC" },
    });
    return row ? this.toSummary(row) : null;
  }

  async findById(id: string): Promise<Listing | null> {
    return this.listings.findOne({ where: { id } });
  }

  /**
   * Keep a live listing aligned with the creator's League party.
   * Steps match 04_LOBBY_SYNC_AND_POSTGAME.md §3.2.4.
   */
  async reconcileParty(
    userId: string,
    listingId: string,
    dto: {
      partyId?: string | null;
      queueId: number;
      members: { puuid: string; summonerId: number; roles: Role[]; isLeader: boolean }[];
      filledRoles: Role[];
      phase: string;
    }
  ): Promise<ListingSummary> {
    const row = await this.requireOwned(userId, listingId);
    const ownerPuuid = row.creatorAccount?.lcuPuuid ?? null;
    if (!ownerPuuid || !dto.members.some((m) => m.puuid === ownerPuuid)) {
      throw new ForbiddenException({ code: "NOT_IN_PARTY" });
    }

    const custom = Boolean(row.queueMeta?.isCustom) || dto.queueId === 0 || dto.queueId === -1;
    const memberCap = custom ? 8 : 5;
    if (dto.members.length > memberCap) {
      throw new BadRequestException({ code: "TOO_MANY_MEMBERS" });
    }

    if (dto.queueId !== row.queueId) {
      const summary = await this.applyStateInternal(row, "delist");
      await this.fanout.emitBoardRemove?.(row.platform, row.queueId, row.id);
      await this.fanout.emitListingState?.(row.creatorAccountId, {
        listingId: row.id,
        status: ListingStatus.DELISTED,
        reason: "QUEUE_CHANGED",
      });
      return summary;
    }

    const live =
      row.status === ListingStatus.LISTED ||
      row.status === ListingStatus.FILLING ||
      row.status === ListingStatus.PAUSED;

    const mapped = await this.mapPartyMembers(row, dto.members);
    row.party = {
      partyId: dto.partyId ?? null,
      members: mapped,
      updatedAt: new Date().toISOString(),
    };

    if (live) {
      const positional = Boolean(row.queueMeta?.positional);
      if (positional) {
        row.slots = reconcilePositionalSlots(normalizeSlots(row.slots), dto.filledRoles);
      }
      const maxLobby = row.queueMeta?.maxLobbySize ?? 5;
      const full = dto.members.length >= maxLobby;
      if (full && (row.status === ListingStatus.LISTED || row.status === ListingStatus.FILLING)) {
        row.status = ListingStatus.PAUSED;
        row.pausedAt = new Date();
        row.pauseReason = LOBBY_FULL_PAUSE;
      } else if (
        !full &&
        row.status === ListingStatus.PAUSED &&
        row.pauseReason === LOBBY_FULL_PAUSE
      ) {
        row.status = ListingStatus.LISTED;
        row.pausedAt = null;
        row.pauseReason = null;
      }
    }

    let saved = await this.listings.save(row);
    const memberAccountIds = mapped
      .map((m) => m.accountId)
      .filter((id): id is string => Boolean(id));
    if (live && memberAccountIds.length && this.partyJoins) {
      await this.partyJoins.confirmLobbyFromParty(saved, memberAccountIds);
      saved =
        (await this.listings.findOne({
          where: { id: saved.id },
          relations: { creatorAccount: true },
        })) ?? saved;
    }

    await this.boardCache.invalidate(saved.platform);
    const summary = this.toSummary(saved);
    await this.fanout.emitBoardUpsert(saved.platform, saved.queueId, { listing: summary });
    await this.fanout.emitListingState?.(saved.creatorAccountId, {
      listingId: saved.id,
      status: saved.status,
    });
    return summary;
  }

  private async mapPartyMembers(
    row: Listing,
    members: { puuid: string; summonerId: number; roles: Role[]; isLeader: boolean }[]
  ): Promise<ListingPartyMember[]> {
    const puuids = members.map((m) => m.puuid).filter(Boolean);
    const linked = puuids.length
      ? await this.accounts.find({ where: { lcuPuuid: In(puuids) } })
      : [];
    const byPuuid = new Map(
      linked.filter((a) => a.lcuPuuid).map((a) => [a.lcuPuuid as string, a])
    );

    const invitedBySummoner = new Map<string, RiotAccount>();
    if (this.joinRequests) {
      const joins = await this.joinRequests.find({
        where: {
          listingId: row.id,
          status: In(["PENDING", "ACCEPTED", "COMPLETED"]),
        },
        relations: { requesterAccount: true },
      });
      for (const join of joins) {
        const acc = join.requesterAccount;
        if (acc?.summonerId != null) invitedBySummoner.set(String(acc.summonerId), acc);
      }
    }

    return members.map((member) => {
      const account =
        byPuuid.get(member.puuid) ?? invitedBySummoner.get(String(member.summonerId)) ?? null;
      if (!account) {
        return {
          accountId: null,
          riotId: null,
          roles: member.roles,
          isLeader: member.isLeader,
        };
      }
      const riotId = account.tagLine ? `${account.riotId}#${account.tagLine}` : account.riotId;
      return {
        accountId: account.id,
        riotId,
        roles: member.roles,
        isLeader: member.isLeader,
      };
    });
  }

  async pauseStalePresence(creatorAccountId: string): Promise<Listing | null> {
    const row = await this.listings.findOne({
      where: {
        creatorAccountId,
        status: In([
          ListingStatus.LISTED,
          ListingStatus.FILLING,
          ListingStatus.READY,
        ]),
      },
    });
    if (!row) return null;
    row.status = ListingStatus.PAUSED;
    row.pausedAt = new Date();
    row.pauseReason = null;
    const saved = await this.listings.save(row);
    await this.boardCache.invalidate(saved.platform);
    return saved;
  }

  async expireDue(): Promise<Listing[]> {
    const due = await this.listings
      .createQueryBuilder("l")
      .where("l.status IN (:...statuses)", {
        statuses: [
          ListingStatus.LISTED,
          ListingStatus.FILLING,
          ListingStatus.READY,
          ListingStatus.PAUSED,
        ],
      })
      .andWhere("l.expires_at < now()")
      .getMany();

    for (const row of due) {
      row.status = ListingStatus.DELISTED;
      row.delistedAt = new Date();
      await this.listings.save(row);
      await this.boardCache.invalidate(row.platform);
      this.emitListingClosed(row.id, "LISTING_EXPIRED");
    }
    return due;
  }

  emitListingClosed(
    listingId: string,
    code: "DELISTED" | "LISTING_EXPIRED" | "LOBBY_FULL"
  ): void {
    this.events.emit("listing.closed", { listingId, code });
  }

  toSummary(row: Listing): ListingSummary {
    const queueMeta =
      row.queueMeta && Object.keys(row.queueMeta).length
        ? row.queueMeta
        : queueMetaFromQueueId(row.queueId);
    return {
      id: row.id,
      creatorAccountId: row.creatorAccountId,
      platform: row.platform,
      queueId: row.queueId,
      type: normalizeListingType(row.type, queueMeta),
      title: row.title,
      description: row.description,
      status: row.status as ListingStatus,
      filters: row.filters,
      slots: normalizeSlots(row.slots),
      voiceRequired: row.voiceRequired,
      languages: row.languages ?? [],
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      queueMeta,
      party: normalizeParty(row.party),
    };
  }

  private resolveQueueMeta(dto: CreateListingDto): ListingQueueMeta {
    const fallback = queueMetaFromQueueId(dto.queueId);
    const raw = dto.queueMeta;
    if (!raw) return fallback;

    const maxLobbySize = Math.max(
      1,
      Math.min(10, Math.floor(raw.maxLobbySize ?? fallback.maxLobbySize))
    );
    return {
      queueId: dto.queueId,
      gameMode: raw.gameMode ?? fallback.gameMode,
      mapId: raw.mapId ?? fallback.mapId,
      maxLobbySize,
      positional: Boolean(raw.positional ?? fallback.positional),
      isCustom: Boolean(raw.isCustom ?? fallback.isCustom),
      rankSource:
        raw.rankSource === "solo" || raw.rankSource === "flex"
          ? raw.rankSource
          : fallback.rankSource,
      duoRules: Boolean(raw.duoRules ?? fallback.duoRules),
    };
  }

  private normalizeAndValidateSlots(
    raw: CreateListingDto["slots"] | PatchListingDto["slots"],
    meta: ListingQueueMeta,
    existing?: ListingSlot[]
  ): ListingSlot[] {
    if (!raw?.length) {
      throw new BadRequestException({ code: "NO_SLOTS" });
    }
    const maxSlots = Math.max(1, Math.min(4, meta.maxLobbySize - 1));
    if (raw.length > maxSlots) {
      throw new BadRequestException({
        code: "TOO_MANY_SLOTS",
        message: `At most ${maxSlots} open slots for this lobby`,
      });
    }

    const previous = normalizeSlots(existing ?? []);
    const incomingIds = new Set(
      raw
        .map((s) => (s.id && typeof s.id === "string" ? s.id : ""))
        .filter((id) => id.length > 0)
    );
    for (const ex of previous) {
      if (ex.pendingAccountId && !incomingIds.has(ex.id)) {
        throw new ConflictException({ code: "SLOT_HAS_PENDING_JOIN" });
      }
    }
    const previousById = new Map(previous.map((s) => [s.id, s]));

    const slots: ListingSlot[] = raw.map((s) => {
      const roles = (s.roles ?? []).filter((r): r is Role => ROLES.has(r as Role));
      const seen = new Set<Role>();
      const uniq: Role[] = [];
      for (const r of roles) {
        if (!seen.has(r)) {
          seen.add(r);
          uniq.push(r);
        }
      }
      const id = s.id && typeof s.id === "string" ? s.id : newSlotId();
      const prev = previousById.get(id);
      if (prev?.pendingAccountId) {
        return {
          id,
          roles: uniq,
          open: false,
          pendingAccountId: prev.pendingAccountId,
          ...(prev.closedReason ? { closedReason: prev.closedReason } : {}),
        };
      }
      const open = Boolean(s.open);
      return {
        id,
        roles: uniq,
        open,
        pendingAccountId: null,
        ...(!open && prev?.closedReason ? { closedReason: prev.closedReason } : {}),
      };
    });

    if (!slots.some((s) => s.open) && !slots.some((s) => s.pendingAccountId)) {
      throw new BadRequestException({ code: "NO_OPEN_SLOTS" });
    }
    return slots;
  }

  private assertTransition(row: Listing, event: ListingStateDto["event"]): void {
    const status = row.status;
    let ok = false;
    switch (event) {
      case "pause":
        ok =
          status === ListingStatus.LISTED ||
          status === ListingStatus.FILLING ||
          status === ListingStatus.READY;
        break;
      case "relist":
        if (status === ListingStatus.PAUSED || status === ListingStatus.POST_SESSION) {
          ok = true;
        } else if (status === ListingStatus.DELISTED) {
          ok = row.expiresAt.getTime() > Date.now();
        }
        break;
      case "delist":
        ok = status !== ListingStatus.DELISTED;
        break;
      case "ready":
        ok = status === ListingStatus.FILLING;
        break;
      case "reopen":
        ok = status === ListingStatus.READY || status === ListingStatus.FILLING;
        break;
      default:
        ok = false;
    }
    if (!ok) {
      throw new ConflictException({ code: "INVALID_TRANSITION" });
    }
  }

  private async requireOwned(userId: string, id: string): Promise<Listing> {
    const row = await this.listings.findOne({
      where: { id },
      relations: { creatorAccount: true },
    });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND" });
    if (row.creatorAccount.userId !== userId) {
      throw new ForbiddenException({ code: "NOT_OWNER" });
    }
    return row;
  }

  /** Delist the account's active listing through the normal delist transition. */
  async delistActiveForAccount(accountId: string): Promise<void> {
    const row = await this.listings.findOne({
      where: {
        creatorAccountId: accountId,
        status: In([...ACTIVE_LISTING_STATUSES]),
      },
    });
    if (!row) return;
    const summary = await this.applyStateInternal(row, "delist");
    const fanout = this.fanout as BoardFanout & {
      emitBoardRemove?: (
        platform: string,
        queueId: number | undefined,
        listingId: string
      ) => Promise<void>;
    };
    await fanout.emitBoardRemove?.(summary.platform, summary.queueId, summary.id);
  }
}

function roleCovered(slot: ListingSlot, filled: Set<Role>): boolean {
  if (!slot.roles.length) return false;
  return slot.roles.every((role) => filled.has(role));
}

/** Close open slots whose roles are all filled. Reopen only FILLED_IN_CLIENT. */
function reconcilePositionalSlots(slots: ListingSlot[], filledRoles: Role[]): ListingSlot[] {
  const filled = new Set(filledRoles);
  return slots.map((slot) => {
    if (slot.pendingAccountId) return slot;
    const covered = roleCovered(slot, filled);
    if (slot.open && covered) {
      return { ...slot, open: false, closedReason: "FILLED_IN_CLIENT" as const };
    }
    if (!slot.open && slot.closedReason === "FILLED_IN_CLIENT" && !covered) {
      return {
        id: slot.id,
        roles: slot.roles,
        open: true,
        pendingAccountId: slot.pendingAccountId ?? null,
      };
    }
    return slot;
  });
}

function normalizeParty(raw: ListingParty | null | undefined): ListingParty | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.members)) return null;
  return raw;
}

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === "23505" || e.driverError?.code === "23505";
}
