import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { BLOCKED_PLATFORMS, isKnownPlatform } from "@lobly/riot-client";
import type { RiotAccountDto } from "@lobly/shared-types";
import { ChampionStat, MatchSeen, ProfileSnapshot, RiotAccount } from "../../database/entities";
import { ProfileJobsService } from "../profile/profile-jobs.service";
import { ListingsService } from "../lobby/listings.service";
import { JoinService } from "../join/join.service";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";
import { LinkRiotAccountDto } from "./dto/link-riot.dto";
import { RiotAuthService } from "./riot-auth.service";

@Injectable()
export class RiotAccountsService {
  constructor(
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(ProfileSnapshot) private readonly snapshots: Repository<ProfileSnapshot>,
    @InjectRepository(ChampionStat) private readonly champStats: Repository<ChampionStat>,
    @InjectRepository(MatchSeen) private readonly matchesSeen: Repository<MatchSeen>,
    private readonly profileJobs: ProfileJobsService,
    private readonly riotAuth: RiotAuthService,
    @Inject(forwardRef(() => ListingsService))
    private readonly listings: ListingsService,
    @Inject(forwardRef(() => JoinService))
    private readonly joins: JoinService,
    @Inject(forwardRef(() => RealtimeFanoutService))
    private readonly fanout: RealtimeFanoutService
  ) {}

  async link(userId: string, dto: LinkRiotAccountDto): Promise<RiotAccountDto> {
    const chal = await this.riotAuth.takeVerifiedChallenge(dto.challengeId);
    const platform = chal.platform.toLowerCase();
    if (BLOCKED_PLATFORMS.has(platform)) {
      throw new ForbiddenException({
        code: "REGION_NOT_SUPPORTED",
        message: "KR region is not supported",
      });
    }
    if (!isKnownPlatform(platform)) {
      throw new BadRequestException({
        code: "INVALID_PLATFORM",
        message: `Unrecognized platform "${platform}"`,
      });
    }

    const existing = await this.accounts.findOne({ where: { puuid: chal.puuid } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException({
        code: "PUUID_TAKEN",
        message: "This Riot account is linked to another LOBLY user",
      });
    }

    const now = new Date();
    let row: RiotAccount;
    if (existing) {
      existing.riotId = chal.gameName;
      existing.tagLine = chal.tagLine;
      existing.lcuPuuid = dto.lcuPuuid ?? existing.lcuPuuid;
      existing.summonerId =
        dto.summonerId != null ? String(dto.summonerId) : existing.summonerId;
      existing.platform = platform;
      existing.verifiedAt = now;
      existing.lastSeenAt = now;
      row = await this.accounts.save(existing);
    } else {
      row = await this.accounts.save(
        this.accounts.create({
          userId,
          puuid: chal.puuid,
          lcuPuuid: dto.lcuPuuid ?? null,
          riotId: chal.gameName,
          tagLine: chal.tagLine,
          summonerId: dto.summonerId != null ? String(dto.summonerId) : null,
          platform,
          verifiedAt: now,
          lastSeenAt: now,
        })
      );
    }

    await this.profileJobs.enqueueRefresh(row.id, "interactive");
    await this.fanout.joinAccountRooms(userId);
    return this.toDto(row);
  }

  async listMine(userId: string): Promise<RiotAccountDto[]> {
    const rows = await this.accounts.find({ where: { userId }, order: { verifiedAt: "DESC" } });
    return rows.map((r) => this.toDto(r));
  }

  async unlink(userId: string, id: string): Promise<{ ok: true }> {
    const row = await this.accounts.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND" });

    await this.listings.delistActiveForAccount(id);
    await this.joins.cancelOutgoingForUser(userId);

    await this.champStats.delete({ riotAccountId: id });
    await this.matchesSeen.delete({ riotAccountId: id });
    await this.snapshots.delete({ riotAccountId: id });
    await this.accounts.delete({ id });
    return { ok: true };
  }

  /**
   * Presence heartbeats carry the LCU's local uuid (that's all the client
   * can observe), so match on lcu_puuid — falling back to puuid for rows
   * linked before lcu_puuid existed.
   */
  async touchLastSeen(observedPuuid: string): Promise<void> {
    const now = new Date();
    const res = await this.accounts.update(
      { lcuPuuid: observedPuuid },
      { lastSeenAt: now }
    );
    if (!res.affected) {
      await this.accounts.update({ puuid: observedPuuid }, { lastSeenAt: now });
    }
  }

  async findById(id: string): Promise<RiotAccount | null> {
    return this.accounts.findOne({ where: { id } });
  }

  async findByUserAndId(userId: string, id: string): Promise<RiotAccount | null> {
    return this.accounts.findOne({ where: { id, userId } });
  }

  async findByPuuid(puuid: string): Promise<RiotAccount | null> {
    return this.accounts.findOne({ where: { puuid } });
  }

  private toDto(row: RiotAccount): RiotAccountDto {
    return {
      id: row.id,
      puuid: row.puuid,
      riotId: row.riotId,
      tagLine: row.tagLine,
      summonerId: row.summonerId,
      platform: row.platform,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    };
  }
}
