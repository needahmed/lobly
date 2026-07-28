import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { BLOCKED_PLATFORMS, RiotHttpError, isKnownPlatform } from "@lobly/riot-client";
import type { RiotAccountDto } from "@lobly/shared-types";
import { ChampionStat, MatchSeen, ProfileSnapshot, RiotAccount } from "../../database/entities";
import { RiotService } from "../riot/riot.service";
import { ProfileJobsService } from "../profile/profile-jobs.service";
import { LinkRiotAccountDto } from "./dto/link-riot.dto";

@Injectable()
export class RiotAccountsService {
  constructor(
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(ProfileSnapshot) private readonly snapshots: Repository<ProfileSnapshot>,
    @InjectRepository(ChampionStat) private readonly champStats: Repository<ChampionStat>,
    @InjectRepository(MatchSeen) private readonly matchesSeen: Repository<MatchSeen>,
    private readonly riot: RiotService,
    private readonly profileJobs: ProfileJobsService
  ) {}

  async link(userId: string, dto: LinkRiotAccountDto): Promise<RiotAccountDto> {
    const platform = dto.platform.toLowerCase();
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

    const region = this.riot.client.regionForPlatform(platform);

    // The client can only report its LOCAL uuid, which Riot's Web API
    // rejects ("Exception decrypting"). Resolve the real PUUID from the
    // Riot ID instead — the LCU having reported this Riot ID at all is
    // what proves ownership, since only the owner can be logged in.
    let account;
    try {
      account = await this.riot.client.accountByRiotId(region, dto.gameName, dto.tagLine);
    } catch (e) {
      if (e instanceof RiotHttpError) {
        if (e.status === 404) {
          throw new NotFoundException({
            code: "RIOT_ID_NOT_FOUND",
            message: `Riot account ${dto.gameName}#${dto.tagLine} not found`,
          });
        }
        // 401/403 (bad/missing API key), 429, or a Riot-side 5xx — none of
        // these are the caller's fault, so surface a clean, retryable
        // error instead of an opaque 500.
        throw new ServiceUnavailableException({
          code: "RIOT_API_UNAVAILABLE",
          message: "Could not verify this account with Riot right now",
        });
      }
      throw e;
    }

    const existing = await this.accounts.findOne({ where: { puuid: account.puuid } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException({
        code: "PUUID_TAKEN",
        message: "This Riot account is linked to another LOBLY user",
      });
    }

    const now = new Date();
    let row: RiotAccount;
    if (existing) {
      existing.riotId = account.gameName;
      existing.tagLine = account.tagLine;
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
          puuid: account.puuid,
          lcuPuuid: dto.lcuPuuid ?? null,
          riotId: account.gameName,
          tagLine: account.tagLine,
          summonerId: dto.summonerId != null ? String(dto.summonerId) : null,
          platform,
          verifiedAt: now,
          lastSeenAt: now,
        })
      );
    }

    await this.profileJobs.enqueueRefresh(row.id, "interactive");
    return this.toDto(row);
  }

  async listMine(userId: string): Promise<RiotAccountDto[]> {
    const rows = await this.accounts.find({ where: { userId }, order: { verifiedAt: "DESC" } });
    return rows.map((r) => this.toDto(r));
  }

  async unlink(userId: string, id: string): Promise<{ ok: true }> {
    const row = await this.accounts.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND" });

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
