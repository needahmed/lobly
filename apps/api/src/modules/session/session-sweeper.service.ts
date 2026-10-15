import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { SessionService } from "./session.service";

export const SESSION_SWEEPER_QUEUE = "session-sweeper";

@Injectable()
export class SessionSweeperService implements OnModuleInit {
  private readonly logger = new Logger(SessionSweeperService.name);

  constructor(
    @InjectQueue(SESSION_SWEEPER_QUEUE) private readonly queue: Queue,
    private readonly sessions: SessionService
  ) {}

  async onModuleInit() {
    await this.queue.add(
      "sweep",
      {},
      {
        repeat: { every: 10 * 60 * 1000 },
        jobId: "session-idle-sweep",
        removeOnComplete: true,
      }
    );
    this.logger.log("Registered session idle sweeper (every 10 min)");
  }

  async run() {
    const n = await this.sessions.sweepIdleSessions();
    if (n) this.logger.log(`Ended ${n} idle sessions`);
  }
}

@Processor(SESSION_SWEEPER_QUEUE)
export class SessionSweeperProcessor extends WorkerHost {
  constructor(private readonly sweeper: SessionSweeperService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.sweeper.run();
  }
}
