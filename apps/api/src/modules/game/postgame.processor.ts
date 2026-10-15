import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { GameLifecycleService } from "./game-lifecycle.service";
import { POSTGAME_BACKOFF_MS, POSTGAME_QUEUE, type PostgameJobData } from "./game.constants";

@Processor(POSTGAME_QUEUE, {
  concurrency: 4,
  settings: {
    backoffStrategy: (attemptsMade: number) =>
      POSTGAME_BACKOFF_MS[Math.max(0, attemptsMade - 1)] ??
      POSTGAME_BACKOFF_MS[POSTGAME_BACKOFF_MS.length - 1],
  },
})
export class PostgameProcessor extends WorkerHost {
  private readonly logger = new Logger(PostgameProcessor.name);

  constructor(private readonly lifecycle: GameLifecycleService) {
    super();
  }

  async process(job: Job<PostgameJobData>): Promise<void> {
    this.logger.log(
      `postgame ${job.data.platform}:${job.data.gameId} account=${job.data.accountId} attempt=${job.attemptsMade + 1}`
    );
    await this.lifecycle.processPostgame(job);
  }
}
