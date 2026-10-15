import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { JOIN_QUEUE, JoinService } from "./join.service";

@Processor(JOIN_QUEUE)
export class JoinProcessor extends WorkerHost {
  constructor(private readonly joins: JoinService) {
    super();
  }

  async process(job: Job<{ joinRequestId: string }>): Promise<void> {
    if (job.name === "timeout") {
      await this.joins.handleTimeout(job.data.joinRequestId);
    } else if (job.name === "pending-timeout") {
      await this.joins.handlePendingTimeout(job.data.joinRequestId);
    }
  }
}
