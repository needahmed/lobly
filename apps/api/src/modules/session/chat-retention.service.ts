import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Queue, Job } from "bullmq";
import { SessionService } from "./session.service";

export const CHAT_RETENTION_QUEUE = "chat-retention";

@Injectable()
export class ChatRetentionService implements OnModuleInit {
  private readonly logger = new Logger(ChatRetentionService.name);

  constructor(
    @InjectQueue(CHAT_RETENTION_QUEUE) private readonly queue: Queue,
    private readonly sessions: SessionService
  ) {}

  async onModuleInit() {
    await this.queue.add(
      "purge",
      {},
      {
        repeat: { every: 24 * 60 * 60 * 1000 },
        jobId: "chat-purge-daily",
        removeOnComplete: true,
      }
    );
    this.logger.log("Registered chat retention job (daily)");
  }

  async runPurge() {
    const n = await this.sessions.purgeOldChat();
    if (n) this.logger.log(`Purged ${n} chat messages`);
  }
}

@Processor(CHAT_RETENTION_QUEUE)
export class ChatRetentionProcessor extends WorkerHost {
  constructor(private readonly retention: ChatRetentionService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.retention.runPurge();
  }
}
