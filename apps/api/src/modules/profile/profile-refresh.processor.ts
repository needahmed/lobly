import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import {
  PROFILE_BACKGROUND_QUEUE,
  PROFILE_INTERACTIVE_QUEUE,
} from "./profile-jobs.service";
import { ProfileRefreshService } from "./profile-refresh.service";

@Processor(PROFILE_INTERACTIVE_QUEUE, { concurrency: 2 })
export class ProfileInteractiveProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileInteractiveProcessor.name);

  constructor(private readonly refresher: ProfileRefreshService) {
    super();
  }

  async process(job: Job<{ riotAccountId: string }>): Promise<void> {
    this.logger.log(`interactive refresh ${job.data.riotAccountId}`);
    await this.refresher.refresh(job.data.riotAccountId);
  }
}

@Processor(PROFILE_BACKGROUND_QUEUE, { concurrency: 1 })
export class ProfileBackgroundProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileBackgroundProcessor.name);

  constructor(private readonly refresher: ProfileRefreshService) {
    super();
  }

  async process(job: Job<{ riotAccountId: string }>): Promise<void> {
    this.logger.log(`background refresh ${job.data.riotAccountId}`);
    await this.refresher.refresh(job.data.riotAccountId);
  }
}
