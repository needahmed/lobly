import { Inject, Injectable, Logger, Optional, forwardRef } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { ArrayContains, In, IsNull, Repository } from "typeorm";
import {
  RiotHttpError,
  type MatchDto,
  type MatchParticipant,
} from "@lobly/riot-client";
import {
  SocketEvents,
  isReputationQueue,
  type GameEndedPayload,
  type GameStartedPayload,
  type PostgameEndorseTarget,
  type PostgameReadyPayload,
} from "@lobly/shared-types";
import { GameReport, RiotAccount, Session } from "../../database/entities";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import { FlagsService } from "../config/flags.service";
import { ProfileRefreshService } from "../profile/profile-refresh.service";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";
import { RiotService } from "../riot/riot.service";
import { SessionService } from "../session/session.service";
import {
  POSTGAME_ATTEMPTS,
  POSTGAME_FIRST_DELAY_MS,
  POSTGAME_QUEUE,
  type PostgameJobData,
} from "./game.constants";

export class RetryablePostgameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryablePostgameError";
  }
}

export interface PostgameJobView {
  data: PostgameJobData;
  attemptsMade: number;
  opts: { attempts?: number };
}

@Injectable()
export class GameLifecycleService {
  private readonly logger = new Logger(GameLifecycleService.name);

  constructor(
    @InjectRepository(GameReport) private readonly reports: Repository<GameReport>,
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(Session) private readonly sessionRows: Repository<Session>,
    @Inject(forwardRef(() => SessionService))
    private readonly sessions: SessionService,
    private readonly refresh: ProfileRefreshService,
    @Inject(forwardRef(() => RealtimeFanoutService))
    private readonly fanout: RealtimeFanoutService,
    @InjectQueue(POSTGAME_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly riot: RiotService,
    @Optional() private readonly flags?: FlagsService
  ) {}

  async onGameStarted(userId: string, payload: GameStartedPayload): Promise<void> {
    if (!this.loopEnabled()) return;
    if (!payload?.gameId) return;
    const account = await this.resolveAccount(userId, payload.memberPuuids);
    if (!account) return;
    const report = await this.upsert(account, {
      gameId: payload.gameId,
      queueId: payload.queueId,
      partyId: payload.partyId,
      memberPuuids: payload.memberPuuids,
      startedAt: new Date(),
    });
    await this.reports.save(report);
  }

  async onGameEnded(userId: string, payload: GameEndedPayload): Promise<{ ok: boolean }> {
    if (!this.loopEnabled()) return { ok: true };
    if (!payload?.gameId) return { ok: false };
    const account = await this.resolveAccount(userId, payload.memberPuuids);
    if (!account) return { ok: false };

    const report = await this.upsert(account, {
      gameId: payload.gameId,
      queueId: payload.queueId,
      partyId: payload.partyId,
      memberPuuids: payload.memberPuuids,
      endedAt: payload.endedAt ? new Date(payload.endedAt) : new Date(),
      terminatedInError: Boolean(payload.terminatedInError),
    });
    await this.reports.save(report);
    await this.attachSession(account, payload.gameId);

    if (!isReputationQueue(payload.queueId ?? report.queueId)) {
      this.logger.log(`skip reputation queue ${payload.queueId} game ${payload.gameId}`);
      return { ok: true };
    }

    const jobId = `postgame:${account.platform}:${payload.gameId}:${account.id}`;
    await this.queue.add(
      "postgame",
      {
        platform: account.platform,
        gameId: payload.gameId,
        accountId: account.id,
        userId: account.userId,
      } satisfies PostgameJobData,
      {
        jobId,
        delay: POSTGAME_FIRST_DELAY_MS,
        attempts: POSTGAME_ATTEMPTS,
        backoff: { type: "custom" },
        removeOnComplete: true,
        removeOnFail: 50,
      }
    );
    return { ok: true };
  }

  async processPostgame(job: PostgameJobView): Promise<void> {
    const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      await this.attempt(job.data);
    } catch (err) {
      if (!last) throw err;
      this.logger.warn(
        `postgame gave up ${job.data.platform}:${job.data.gameId}: ${String(err)}`
      );
      await this.finalFailure(job.data);
    }
  }

  private loopEnabled(): boolean {
    if (!this.flags) return true;
    return this.flags.getFlags().postgameLoop !== false;
  }

  private async attempt(data: PostgameJobData): Promise<void> {
    const report = await this.reports.findOne({
      where: {
        gameId: String(data.gameId),
        platform: data.platform,
        riotAccountId: data.accountId,
      },
    });
    if (!report) return;
    const account = await this.accounts.findOne({ where: { id: data.accountId } });
    if (!account) return;

    const matchId = `${data.platform.toUpperCase()}_${data.gameId}`;
    const region = this.riotClient().regionForPlatform(data.platform);
    const lockKey = `postgame:fetch:${data.platform}:${data.gameId}`;
    const locked = await this.redis.set(lockKey, data.accountId, "EX", 30, "NX");
    if (locked !== "OK") {
      throw new RetryablePostgameError("fetch lock held");
    }
    try {
      let match: MatchDto;
      try {
        match = await this.riotClient().matchById(region, matchId);
      } catch (err) {
        if (err instanceof RiotHttpError && err.status === 404) {
          throw new RetryablePostgameError(`404 ${matchId}`);
        }
        throw err;
      }
      report.riotMatchId = matchId;
      report.riotConfirmedAt = new Date();
      await this.reports.save(report);
      await this.refresh.refresh(data.accountId, { mustIncludeMatchId: matchId });
      await this.verifyAndEmit(account, report, match, true);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private async finalFailure(data: PostgameJobData): Promise<void> {
    try {
      await this.refresh.refresh(data.accountId);
    } catch (err) {
      this.logger.warn(`plain refresh failed ${data.accountId}: ${String(err)}`);
    }
    await this.fanout.emitToUser(data.userId, SocketEvents.POSTGAME_READY, {
      gameId: data.gameId,
      profileRefreshed: true,
      riotConfirmed: false,
      endorse: null,
    } satisfies PostgameReadyPayload);
  }

  private async verifyAndEmit(
    account: RiotAccount,
    report: GameReport,
    match: MatchDto,
    profileRefreshed: boolean
  ): Promise<void> {
    const session = await this.attachSession(account, Number(report.gameId));
    let endorse: PostgameReadyPayload["endorse"] = null;
    if (session) {
      const members = await this.accounts.find({
        where: { id: In(session.memberAccountIds) },
      });
      const sameTeam = teamMatches(members, match.info.participants ?? []);
      if (sameTeam) {
        await this.sessions.onGameEnded(session, Number(report.gameId));
        for (const member of members) {
          const others = endorseTargets(members, member.id, match.info.participants ?? []);
          await this.fanout.emitToUser(member.userId, SocketEvents.POSTGAME_READY, {
            gameId: Number(report.gameId),
            profileRefreshed,
            riotConfirmed: true,
            sessionId: session.id,
            endorse: { sessionId: session.id, others },
          } satisfies PostgameReadyPayload);
        }
        return;
      }
    }
    await this.fanout.emitToUser(account.userId, SocketEvents.POSTGAME_READY, {
      gameId: Number(report.gameId),
      profileRefreshed,
      riotConfirmed: true,
      sessionId: session?.id ?? null,
      endorse,
    } satisfies PostgameReadyPayload);
  }

  private async attachSession(account: RiotAccount, gameId: number): Promise<Session | null> {
    const open = await this.sessionRows.find({
      where: { endedAt: IsNull(), memberAccountIds: ArrayContains([account.id]) },
    });
    for (const session of open) {
      if (session.source === "ORGANIC" && !this.flags?.getFlags().organicEndorse) continue;
      const reports = await this.reports.find({
        where: {
          gameId: String(gameId),
          platform: account.platform,
          riotAccountId: In(session.memberAccountIds),
        },
      });
      const reported = new Set(reports.map((r) => r.riotAccountId));
      if (!session.memberAccountIds.every((id) => reported.has(id))) continue;
      for (const row of reports) {
        if (row.sessionId !== session.id) {
          row.sessionId = session.id;
          await this.reports.save(row);
        }
      }
      return session;
    }
    return null;
  }

  private async upsert(
    account: RiotAccount,
    patch: {
      gameId: number;
      queueId?: number;
      partyId?: string | null;
      memberPuuids?: string[];
      startedAt?: Date;
      endedAt?: Date;
      terminatedInError?: boolean;
    }
  ): Promise<GameReport> {
    const existing = await this.reports.findOne({
      where: {
        gameId: String(patch.gameId),
        platform: account.platform,
        riotAccountId: account.id,
      },
    });
    const row =
      existing ??
      this.reports.create({
        gameId: String(patch.gameId),
        platform: account.platform,
        riotAccountId: account.id,
        memberLcuPuuids: [],
        terminatedInError: false,
      });
    if (patch.queueId != null) row.queueId = patch.queueId;
    if (patch.partyId !== undefined) row.partyId = patch.partyId ?? null;
    if (patch.memberPuuids) row.memberLcuPuuids = patch.memberPuuids;
    if (patch.startedAt && !row.startedAt) row.startedAt = patch.startedAt;
    if (patch.endedAt) row.endedAt = patch.endedAt;
    if (patch.terminatedInError) row.terminatedInError = true;
    return row;
  }

  private async resolveAccount(
    userId: string,
    memberPuuids?: string[]
  ): Promise<RiotAccount | null> {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) return null;
    const hit = memberPuuids?.length
      ? mine.find((a) => a.lcuPuuid && memberPuuids.includes(a.lcuPuuid))
      : undefined;
    if (hit) return hit;
    return [...mine].sort(
      (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0)
    )[0];
  }

  private riotClient() {
    return this.riot.client;
  }
}

function teamMatches(members: RiotAccount[], participants: MatchParticipant[]): boolean {
  const found: MatchParticipant[] = [];
  for (const member of members) {
    const participant = participants.find((p) => p.puuid === member.puuid);
    if (!participant) return false;
    found.push(participant);
  }
  if (found.length !== members.length) return false;
  const teams = new Set(found.map((p) => p.teamId));
  return teams.size === 1;
}

function endorseTargets(
  members: RiotAccount[],
  selfId: string,
  participants: MatchParticipant[]
): PostgameEndorseTarget[] {
  return members
    .filter((m) => m.id !== selfId)
    .map((m) => {
      const participant = participants.find((p) => p.puuid === m.puuid);
      return {
        accountId: m.id,
        riotId: m.riotId,
        tagLine: m.tagLine,
        role: participant?.teamPosition ?? null,
      };
    });
}
