import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { MetricsEvent } from "../../database/entities";

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(MetricsEvent)
    private readonly events: Repository<MetricsEvent>
  ) {}

  async log(
    name: string,
    opts: {
      accountId?: string;
      listingId?: string;
      sessionId?: string;
      joinRequestId?: string;
      meta?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        name,
        accountId: opts.accountId ?? null,
        listingId: opts.listingId ?? null,
        sessionId: opts.sessionId ?? null,
        joinRequestId: opts.joinRequestId ?? null,
        meta: opts.meta ?? {},
      })
    );
  }

  async funnel(day?: string) {
    const start = day
      ? new Date(`${day}T00:00:00.000Z`)
      : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const rows = await this.events.find({
      where: { at: Between(start, end) },
    });

    const byName = (n: string) => rows.filter((r) => r.name === n);
    const published = byName("listing_published").length;
    const requested = byName("join_requested").length;
    const accepted = byName("join_accepted").length;
    const confirmed = byName("lobby_confirmed");
    const noshows = byName("no_show").length;
    const completed = byName("session_completed").length;
    const repeats = byName("repeat_pair").length;

    const times = confirmed
      .map((c) => Number(c.meta?.msToConfirm ?? NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const medianMs =
      times.length === 0
        ? null
        : times.length % 2 === 1
          ? times[(times.length - 1) / 2]
          : (times[times.length / 2 - 1] + times[times.length / 2]) / 2;

    return {
      day: start.toISOString().slice(0, 10),
      listingPublished: published,
      joinRequested: requested,
      joinAccepted: accepted,
      lobbyConfirmed: confirmed.length,
      noShows: noshows,
      sessionCompleted: completed,
      repeatPairs: repeats,
      fillRate: published ? completed / published : null,
      noShowRate: accepted ? noshows / accepted : null,
      medianTimeToFullLobbyMs: medianMs,
    };
  }
}
