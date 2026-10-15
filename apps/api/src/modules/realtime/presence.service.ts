import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import { ListingsService } from "../lobby/listings.service";
import { RiotAccountsService } from "../identity/riot-accounts.service";
import { RealtimeFanoutService } from "./realtime-fanout.service";
import { ListingStatus } from "@lobly/shared-types";

const PRESENCE_TTL = 90;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private watcherStarted = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly listings: ListingsService,
    private readonly accounts: RiotAccountsService,
    private readonly fanout: RealtimeFanoutService
  ) {}

  presenceKey(userId: string): string {
    return `presence:${userId}`;
  }

  async heartbeat(
    userId: string,
    payload: {
      phase?: string;
      listingStatus?: string;
      observedPuuid?: string;
      listingId?: string;
      partyId?: string;
      gameId?: number;
    }
  ): Promise<void> {
    const key = this.presenceKey(userId);
    await this.redis.set(
      key,
      JSON.stringify({ ...payload, userId, at: Date.now() }),
      "EX",
      PRESENCE_TTL
    );
    await this.redis.sadd("presence:watch", userId);

    if (payload.observedPuuid) {
      await this.accounts.touchLastSeen(payload.observedPuuid);
    }

    if (
      payload.phase &&
      ["ChampSelect", "GameStart", "InProgress"].includes(payload.phase)
    ) {
      const mine = await this.listings.mine(userId);
      if (
        mine &&
        [ListingStatus.LISTED, ListingStatus.FILLING, ListingStatus.READY].includes(
          mine.status
        )
      ) {
        const summary = await this.listings.applyState(userId, mine.id, {
          event: "pause",
          phase: payload.phase,
        });
        await this.fanout.emitBoardRemove(
          summary.platform,
          summary.queueId,
          summary.id
        );
        await this.fanout.emitListingStateToUser(userId, {
          listingId: summary.id,
          status: summary.status,
          reason: "phase",
        });
      }
    }
  }

  startExpiryWatcher() {
    if (this.watcherStarted) return;
    this.watcherStarted = true;
    setInterval(() => {
      void this.sweepMissingPresence();
    }, 15_000);
    this.logger.log("Presence expiry watcher started (15s)");
  }

  private async sweepMissingPresence() {
    const members = await this.redis.smembers("presence:watch");
    for (const userId of members) {
      try {
        await this.sweepOne(userId);
      } catch (e) {
        // One malformed/stale entry must never take down the whole sweep
        // (or the process — this runs on a bare setInterval with no
        // caller to catch a rejection).
        this.logger.error(`sweep failed for ${userId}: ${(e as Error).message}`);
        await this.redis.srem("presence:watch", userId).catch(() => undefined);
      }
    }
  }

  private async sweepOne(userId: string) {
    const alive = await this.redis.exists(this.presenceKey(userId));
    if (alive) return;

    const mine = await this.listings.mine(userId);
    if (
      mine &&
      [ListingStatus.LISTED, ListingStatus.FILLING, ListingStatus.READY].includes(
        mine.status
      )
    ) {
      const paused = await this.listings.pauseStalePresence(mine.creatorAccountId);
      if (paused) {
        this.logger.log(`Paused listing ${paused.id} — presence expired`);
        await this.fanout.emitBoardRemove(
          paused.platform,
          paused.queueId,
          paused.id
        );
        await this.fanout.emitListingStateToUser(userId, {
          listingId: paused.id,
          status: ListingStatus.PAUSED,
          reason: "presence_expired",
        });
      }
    }
    await this.redis.srem("presence:watch", userId);
  }

  async watchUser(userId: string): Promise<void> {
    await this.redis.sadd("presence:watch", userId);
  }
}
