import { ProfileJobsService } from "./profile-jobs.service";

/**
 * Models BullMQ's jobId dedupe: add() is ignored while a job with that id
 * still exists. removeOnComplete: true drops it on completion, so the next
 * add creates a new job.
 */
class FakeQueue {
  jobs = new Map<
    string,
    {
      id: string;
      opts: { removeOnComplete?: boolean | number; removeOnFail?: boolean | number };
    }
  >();
  added = 0;

  async add(
    _name: string,
    _data: unknown,
    opts: {
      jobId: string;
      removeOnComplete?: boolean | number;
      removeOnFail?: boolean | number;
    }
  ) {
    const existing = this.jobs.get(opts.jobId);
    if (existing) return existing;
    const job = { id: opts.jobId, opts };
    this.jobs.set(opts.jobId, job);
    this.added += 1;
    return job;
  }

  complete(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.opts.removeOnComplete === true) this.jobs.delete(jobId);
  }
}

describe("ProfileJobsService", () => {
  it("enqueues again after a completed job with the same id", async () => {
    const interactive = new FakeQueue();
    const background = new FakeQueue();
    const svc = new ProfileJobsService(interactive as never, background as never);

    await svc.enqueueRefresh("acc-1", "interactive");
    expect(interactive.added).toBe(1);
    const first = interactive.jobs.get("refresh:interactive:acc-1");
    expect(first?.opts.removeOnComplete).toBe(true);
    expect(first?.opts.removeOnFail).toBe(true);

    interactive.complete("refresh:interactive:acc-1");
    await svc.enqueueRefresh("acc-1", "interactive");
    expect(interactive.added).toBe(2);
    expect(background.added).toBe(0);
  });
});
