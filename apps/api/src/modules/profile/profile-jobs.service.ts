import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

export type RefreshPriority = "interactive" | "background";

export const PROFILE_INTERACTIVE_QUEUE = "profile-refresh-interactive";
export const PROFILE_BACKGROUND_QUEUE = "profile-refresh-background";

@Injectable()
export class ProfileJobsService {
  constructor(
    @InjectQueue(PROFILE_INTERACTIVE_QUEUE) private readonly interactive: Queue,
    @InjectQueue(PROFILE_BACKGROUND_QUEUE) private readonly background: Queue
  ) {}

  async enqueueRefresh(riotAccountId: string, priority: RefreshPriority): Promise<void> {
    const queue = priority === "interactive" ? this.interactive : this.background;
    // BullMQ 5 keeps a completed job under its jobId until it is removed, and
    // add() is a no-op while that id exists. `true` deletes it immediately so
    // the next refresh for this account is actually enqueued.
    await queue.add(
      "profile.refresh",
      { riotAccountId },
      {
        jobId: `refresh:${priority}:${riotAccountId}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      }
    );
  }
}
