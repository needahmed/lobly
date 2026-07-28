import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Inject, forwardRef } from "@nestjs/common";
import { MoreThan, Repository } from "typeorm";
import type { EndorseKind, ReportReason } from "@lobly/shared-types";
import {
  Block,
  Endorsement,
  ReliabilityEvent,
  Report,
  RiotAccount,
  Session,
  User,
} from "../../database/entities";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import type Redis from "ioredis";
import { computeReliabilityScore, isProvisional } from "./reliability";
import { ProfileService } from "../profile/profile.service";

const REP_CACHE_TTL = 15 * 60;

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(ReliabilityEvent)
    private readonly events: Repository<ReliabilityEvent>,
    @InjectRepository(Endorsement)
    private readonly endorsements: Repository<Endorsement>,
    @InjectRepository(Block) private readonly blocks: Repository<Block>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(RiotAccount)
    private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(forwardRef(() => ProfileService))
    private readonly profiles: ProfileService
  ) {}

  async recordEvent(
    accountId: string,
    kind: string,
    opts: { sessionId?: string; joinRequestId?: string } = {}
  ): Promise<void> {
    // Idempotent SHOWED / ACCEPTED per join_request
    if (opts.joinRequestId && (kind === "SHOWED" || kind === "ACCEPTED")) {
      const existing = await this.events.findOne({
        where: { joinRequestId: opts.joinRequestId, kind, accountId },
      });
      if (existing) return;
    }

    await this.events.save(
      this.events.create({
        accountId,
        kind,
        sessionId: opts.sessionId ?? null,
        joinRequestId: opts.joinRequestId ?? null,
      })
    );
    await this.redis.del(`rep:${accountId}`);
  }

  async getReliability(accountId: string): Promise<number | null> {
    const cached = await this.redis.get(`rep:${accountId}`);
    if (cached === "null") return null;
    if (cached != null) return Number(cached);

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await this.events.find({
      where: { accountId, at: MoreThan(since) },
    });
    const score = computeReliabilityScore(rows);
    await this.redis.setex(
      `rep:${accountId}`,
      REP_CACHE_TTL,
      score == null ? "null" : String(score)
    );
    return score;
  }

  async getEndorsementCounts(accountId: string) {
    const rows = await this.endorsements.find({
      where: { toAccountId: accountId },
    });
    const counts = { goodComms: 0, goodTeammate: 0, skilled: 0 };
    for (const r of rows) {
      if (r.kind === "GOOD_COMMS") counts.goodComms++;
      else if (r.kind === "GOOD_TEAMMATE") counts.goodTeammate++;
      else if (r.kind === "SKILLED") counts.skilled++;
    }
    return counts;
  }

  async getReputationBlock(accountId: string) {
    const reliability = await this.getReliability(accountId);
    const endorsements = await this.getEndorsementCounts(accountId);
    const snap = await this.profiles.getSnapshotEntity(accountId);
    return {
      reliability,
      endorsements,
      provisional: isProvisional({
        reliability,
        summonerLevel: snap?.summonerLevel ?? null,
        gamesThisSeason: snap?.gamesThisSeason ?? null,
      }),
    };
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const row = await this.blocks.findOne({
      where: [
        { blockerAccountId: a, blockedAccountId: b },
        { blockerAccountId: b, blockedAccountId: a },
      ],
    });
    return !!row;
  }

  async getBlockedPairsForViewer(
    viewerAccountId: string
  ): Promise<Set<string>> {
    const rows = await this.blocks.find({
      where: [
        { blockerAccountId: viewerAccountId },
        { blockedAccountId: viewerAccountId },
      ],
    });
    const set = new Set<string>();
    for (const r of rows) {
      if (r.blockerAccountId === viewerAccountId) set.add(r.blockedAccountId);
      else set.add(r.blockerAccountId);
    }
    return set;
  }

  async block(userId: string, targetAccountId: string) {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) throw new BadRequestException({ code: "NO_RIOT_ACCOUNT" });
    const target = await this.accounts.findOne({ where: { id: targetAccountId } });
    if (!target) throw new NotFoundException({ code: "NOT_FOUND" });
    if (mine.some((m) => m.id === targetAccountId)) {
      throw new BadRequestException({ code: "CANNOT_BLOCK_SELF" });
    }
    const blocker = mine[0];
    await this.blocks.save(
      this.blocks.create({
        blockerAccountId: blocker.id,
        blockedAccountId: targetAccountId,
      })
    );
    return { ok: true };
  }

  async unblock(userId: string, targetAccountId: string) {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) return { ok: true };
    await this.blocks.delete({
      blockerAccountId: mine[0].id,
      blockedAccountId: targetAccountId,
    });
    return { ok: true };
  }

  async listBlocks(userId: string) {
    const mine = await this.accounts.find({ where: { userId } });
    if (!mine.length) return [];
    const rows = await this.blocks.find({
      where: { blockerAccountId: mine[0].id },
    });
    return rows.map((r) => ({
      accountId: r.blockedAccountId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async endorse(
    userId: string,
    sessionId: string,
    toAccountId: string,
    kinds: EndorseKind[]
  ) {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException({ code: "NOT_FOUND" });
    if (!session.endedAt) {
      throw new BadRequestException({ code: "SESSION_NOT_ENDED" });
    }
    if (Date.now() - session.endedAt.getTime() > 24 * 60 * 60 * 1000) {
      throw new BadRequestException({ code: "ENDORSE_WINDOW_CLOSED" });
    }

    const mine = await this.accounts.find({ where: { userId } });
    const from = mine.find((a) => session.memberAccountIds.includes(a.id));
    if (!from) throw new ForbiddenException({ code: "NOT_MEMBER" });
    if (from.id === toAccountId) {
      throw new BadRequestException({ code: "CANNOT_ENDORSE_SELF" });
    }
    if (!session.memberAccountIds.includes(toAccountId)) {
      throw new BadRequestException({ code: "NOT_SESSION_MEMBER" });
    }

    const allowed: EndorseKind[] = ["GOOD_COMMS", "GOOD_TEAMMATE", "SKILLED"];
    for (const kind of kinds) {
      if (!allowed.includes(kind)) continue;
      try {
        await this.endorsements.save(
          this.endorsements.create({
            sessionId,
            fromAccountId: from.id,
            toAccountId,
            kind,
          })
        );
      } catch {
        /* PK duplicate — ignore */
      }
    }
    return { ok: true };
  }

  async report(
    userId: string,
    body: {
      accountId: string;
      sessionId?: string;
      reason: ReportReason;
      detail?: string;
    }
  ) {
    const dayKey = `reports:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const count = await this.redis.incr(dayKey);
    if (count === 1) await this.redis.expire(dayKey, 86400);
    if (count > 10) throw new BadRequestException({ code: "REPORT_CAP" });

    const mine = await this.accounts.find({ where: { userId } });
    const reporter = mine[0] ?? null;
    const row = await this.reports.save(
      this.reports.create({
        reporterAccountId: reporter?.id ?? null,
        reportedAccountId: body.accountId,
        sessionId: body.sessionId ?? null,
        reason: body.reason,
        detail: body.detail ?? null,
        status: "OPEN",
      })
    );
    return { id: row.id, status: row.status };
  }

  async listOpenReports() {
    return this.reports.find({
      where: { status: "OPEN" },
      order: { createdAt: "DESC" },
      take: 100,
    });
  }

  async resolveReport(
    id: string,
    body: { status: string; action?: string }
  ) {
    const row = await this.reports.findOne({ where: { id } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND" });
    row.status = body.status;
    row.adminAction = body.action ?? null;
    row.resolvedAt = new Date();
    await this.reports.save(row);

    if (body.action === "LISTING_BAN_7D" || body.action === "ACCOUNT_BAN") {
      const reported = await this.accounts.findOne({
        where: { id: row.reportedAccountId },
      });
      if (reported) {
        const user = await this.users.findOne({ where: { id: reported.userId } });
        if (user) {
          if (body.action === "ACCOUNT_BAN") user.banned = true;
          if (body.action === "LISTING_BAN_7D") {
            user.listingBannedUntil = new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000
            );
          }
          await this.users.save(user);
        }
      }
    }
    return row;
  }

  async assertUserCanListOrJoin(userId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new ForbiddenException({ code: "NO_USER" });
    if (user.banned) throw new ForbiddenException({ code: "ACCOUNT_BANNED" });
    if (
      user.listingBannedUntil &&
      user.listingBannedUntil.getTime() > Date.now()
    ) {
      throw new ForbiddenException({
        code: "LISTING_BANNED",
        until: user.listingBannedUntil.toISOString(),
      });
    }
  }
}
