import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
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
  type ListingQueueMeta,
  type ListingSlot,
  type ListingSummary,
  type Role,
} from "@lobly/shared-types";
import { Listing, RiotAccount, User } from "../../database/entities";
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

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly profiles: ProfileService,
    private readonly boardCache: BoardCacheService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly metrics?: MetricsService
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
        row.queueMeta ?? queueMetaFromQueueId(row.queueId)
      );
    }
    if (dto.voiceRequired !== undefined) row.voiceRequired = dto.voiceRequired;
    if (dto.languages !== undefined) row.languages = dto.languages;
    if (dto.durationMin !== undefined) {
      row.expiresAt = new Date(Date.now() + dto.durationMin * 60 * 1000);
    }
    const saved = await this.listings.save(row);
    await this.boardCache.invalidate(saved.platform);
    return this.toSummary(saved);
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
    if (
      phase &&
      ["ChampSelect", "GameStart", "InProgress"].includes(phase) &&
      event !== "delist"
    ) {
      row.status = ListingStatus.PAUSED;
      row.pausedAt = new Date();
    } else {
      const next = EVENT_TO_STATUS[event];
      row.status = next;
      if (next === ListingStatus.PAUSED) row.pausedAt = new Date();
      if (next === ListingStatus.DELISTED) row.delistedAt = new Date();
      if (next === ListingStatus.LISTED) {
        row.pausedAt = null;
        row.delistedAt = null;
      }
    }

    const saved = await this.listings.save(row);
    await this.boardCache.invalidate(saved.platform);
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
   * Reconcile open slots with free seats observed in the League lobby.
   * Closes surplus open slots (or opens new any-role slots) so the board
   * reflects reality when people join/leave outside LOBLY.
   */
  async reconcileSlots(
    userId: string,
    listingId: string,
    freeSeats: number
  ): Promise<ListingSummary> {
    const row = await this.requireOwned(userId, listingId);
    const seats = Math.max(0, Math.min(4, Math.floor(freeSeats)));
    let slots = normalizeSlots(row.slots);
    const openCount = slots.filter((s) => s.open).length;

    if (seats === 0) {
      // Lobby full — pause so it disappears from candidates
      row.status = ListingStatus.PAUSED;
      row.pausedAt = new Date();
      slots = slots.map((s) =>
        s.open ? { ...s, open: false, pendingAccountId: null } : s
      );
    } else if (openCount > seats) {
      let toClose = openCount - seats;
      slots = slots.map((s) => {
        if (s.open && toClose > 0) {
          toClose -= 1;
          return { ...s, open: false, pendingAccountId: null };
        }
        return s;
      });
    } else if (openCount < seats) {
      const toAdd = seats - openCount;
      for (let i = 0; i < toAdd; i++) {
        slots.push({
          id: newSlotId(),
          roles: [],
          open: true,
          pendingAccountId: null,
        });
      }
    }

    row.slots = slots;
    const saved = await this.listings.save(row);
    await this.boardCache.invalidate(saved.platform);
    return this.toSummary(saved);
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
    }
    return due;
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
    meta: ListingQueueMeta
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

    const slots: ListingSlot[] = raw.map((s, i) => {
      const roles = (s.roles ?? []).filter((r): r is Role => ROLES.has(r as Role));
      // Deduplicate while preserving order
      const seen = new Set<Role>();
      const uniq: Role[] = [];
      for (const r of roles) {
        if (!seen.has(r)) {
          seen.add(r);
          uniq.push(r);
        }
      }
      return {
        id: s.id && typeof s.id === "string" ? s.id : newSlotId(),
        roles: uniq,
        open: Boolean(s.open),
        pendingAccountId: s.pendingAccountId ?? null,
      };
    });

    if (!slots.some((s) => s.open)) {
      throw new BadRequestException({ code: "NO_OPEN_SLOTS" });
    }
    return slots;
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
}
