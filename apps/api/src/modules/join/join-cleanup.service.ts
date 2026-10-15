import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { In, Repository } from "typeorm";
import { SocketEvents } from "@lobly/shared-types";
import { JoinRequest, RiotAccount } from "../../database/entities";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";
import { JOIN_QUEUE, LISTING_CLOSED_EVENT, type ListingClosedEvent } from "./join.constants";

@Injectable()
export class JoinCleanupService {
  constructor(
    @InjectRepository(JoinRequest)
    private readonly joins: Repository<JoinRequest>,
    @InjectRepository(RiotAccount)
    private readonly accounts: Repository<RiotAccount>,
    @Inject(forwardRef(() => RealtimeFanoutService))
    private readonly fanout: RealtimeFanoutService,
    @InjectQueue(JOIN_QUEUE) private readonly queue: Queue
  ) {}

  @OnEvent(LISTING_CLOSED_EVENT)
  async onListingClosed(payload: ListingClosedEvent): Promise<void> {
    if (!payload?.listingId || !payload.code) return;
    await this.closePendingForListing(payload.listingId, payload.code);
  }

  /** Expire every PENDING request on a listing and tell each requester. No reputation penalty. */
  async closePendingForListing(listingId: string, code: string): Promise<void> {
    const rows = await this.joins.find({
      where: { listingId, status: "PENDING" },
    });
    for (const jr of rows) {
      await this.expirePending(jr, code);
    }
  }

  /** Expire this user's PENDING requests, optionally keeping one (the one just accepted). */
  async closePendingForRequester(
    userId: string,
    code: string,
    exceptJoinRequestId?: string
  ): Promise<void> {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) return;
    const rows = await this.joins.find({
      where: {
        requesterAccountId: In(mine.map((a) => a.id)),
        status: "PENDING",
      },
    });
    for (const jr of rows) {
      if (exceptJoinRequestId && jr.id === exceptJoinRequestId) continue;
      await this.expirePending(jr, code, userId);
    }
  }

  private async expirePending(
    jr: JoinRequest,
    code: string,
    userId?: string
  ): Promise<void> {
    jr.status = "EXPIRED";
    jr.decidedAt = new Date();
    await this.joins.save(jr);
    try {
      await this.queue.remove(`join-pending-${jr.id}`);
    } catch {
      /* job may already be gone */
    }

    const notifyUser =
      userId ??
      (
        await this.accounts.findOne({
          where: { id: jr.requesterAccountId },
        })
      )?.userId;
    if (!notifyUser) return;
    await this.fanout.emitToUser(notifyUser, SocketEvents.JOIN_FAILED, {
      joinRequestId: jr.id,
      code,
    });
  }
}
