/**
 * Runs async jobs strictly one at a time, in submission order. LCU events
 * arrive from up to two push channels plus REST seeding; processing them
 * concurrently lets a slow REST fallback for an old event land after a newer
 * one. A failing job is logged by the caller and never stalls the queue.
 */
export class SerialQueue {
    tail = Promise.resolve();
    push(job) {
        const run = this.tail.then(job, job);
        this.tail = run.catch(() => undefined);
        return run;
    }
    /** Resolves once every job queued so far has finished. */
    idle() {
        return this.tail;
    }
}
