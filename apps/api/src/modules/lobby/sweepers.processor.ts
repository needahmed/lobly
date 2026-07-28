import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { SWEEPER_QUEUE, SweepersService } from "./sweepers.service";

@Processor(SWEEPER_QUEUE)
export class SweepersProcessor extends WorkerHost {
  constructor(private readonly sweepers: SweepersService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === "expire") {
      await this.sweepers.runExpiry();
    }
  }
}
