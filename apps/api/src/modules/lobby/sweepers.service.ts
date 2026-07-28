import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ListingsService } from "./listings.service";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";

export const SWEEPER_QUEUE = "lobby-sweepers";

@Injectable()
export class SweepersService implements OnModuleInit {
  private readonly logger = new Logger(SweepersService.name);

  constructor(
    @InjectQueue(SWEEPER_QUEUE) private readonly queue: Queue,
    private readonly listings: ListingsService,
    private readonly fanout: RealtimeFanoutService
  ) {}

  async onModuleInit() {
    await this.queue.add(
      "expire",
      {},
      {
        repeat: { every: 60_000 },
        jobId: "listing-expire-sweeper",
        removeOnComplete: true,
      }
    );
    this.logger.log("Registered listing expiry sweeper (60s)");
  }

  async runExpiry(): Promise<void> {
    const expired = await this.listings.expireDue();
    for (const row of expired) {
      await this.fanout.emitBoardRemove(row.platform, row.queueId, row.id);
      await this.fanout.emitListingState(row.creatorAccountId, {
        listingId: row.id,
        status: row.status,
        reason: "expired",
      });
    }
    if (expired.length) {
      this.logger.log(`Expired ${expired.length} listings`);
    }
  }
}
