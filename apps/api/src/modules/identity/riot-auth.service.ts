import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomInt, randomUUID } from "crypto";
import type Redis from "ioredis";
import { BLOCKED_PLATFORMS, RiotHttpError, isKnownPlatform } from "@lobly/riot-client";
import type { AuthTokens } from "@lobly/shared-types";
import { RiotAccount, User } from "../../database/entities";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import { RiotService } from "../riot/riot.service";
import { ProfileJobsService } from "../profile/profile-jobs.service";
import { RealtimeFanoutService } from "../realtime/realtime-fanout.service";
import { AuthService } from "./auth.service";
import { RiotChallengeDto, RiotVerifyDto } from "./dto/riot-auth.dto";

/** Always-owned starter profile icons. */
const STARTER_ICON_MIN = 0;
const STARTER_ICON_MAX = 28;
const CHALLENGE_TTL_SEC = 600;
const ICON_POLL_MS = 3_000;
const ICON_POLL_TIMEOUT_MS = 60_000;

export interface RiotChallengePayload {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: string;
  iconId: number;
  originalIconId: number;
}

/**
 * Profile-icon proof of Riot account ownership.
 * Riot Sign-On can replace `createChallenge` / `takeVerifiedChallenge` later
 * without changing token issuance.
 */
@Injectable()
export class RiotAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    private readonly riot: RiotService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly auth: AuthService,
    private readonly profileJobs: ProfileJobsService,
    @Inject(forwardRef(() => RealtimeFanoutService))
    private readonly fanout: RealtimeFanoutService
  ) {}

  async createChallenge(dto: RiotChallengeDto): Promise<{
    challengeId: string;
    iconId: number;
    expiresAt: string;
  }> {
    const platform = this.assertPlatform(dto.platform);
    const region = this.riot.client.regionForPlatform(platform);

    let account;
    try {
      account = await this.riot.client.accountByRiotId(region, dto.gameName, dto.tagLine);
    } catch (e) {
      throw this.mapRiotError(e, dto.gameName, dto.tagLine);
    }

    let summoner;
    try {
      summoner = await this.riot.client.summonerByPuuid(platform, account.puuid);
    } catch (e) {
      throw this.mapRiotError(e, dto.gameName, dto.tagLine);
    }

    const originalIconId = summoner.profileIconId;
    const iconId = pickChallengeIcon(originalIconId);
    const challengeId = randomUUID();
    const payload: RiotChallengePayload = {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      platform,
      iconId,
      originalIconId,
    };
    await this.redis.set(
      this.challengeKey(challengeId),
      JSON.stringify(payload),
      "EX",
      CHALLENGE_TTL_SEC
    );

    return {
      challengeId,
      iconId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SEC * 1000).toISOString(),
    };
  }

  /**
   * Blocks until the summoner's icon matches the challenge, or 60s elapse.
   * Deletes the Redis key only after a match so a timed-out client can retry.
   */
  async takeVerifiedChallenge(challengeId: string): Promise<RiotChallengePayload> {
    const key = this.challengeKey(challengeId);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new BadRequestException({
        code: "CHALLENGE_NOT_FOUND",
        message: "Challenge expired or unknown",
      });
    }

    let chal: RiotChallengePayload;
    try {
      chal = JSON.parse(raw) as RiotChallengePayload;
    } catch {
      throw new BadRequestException({
        code: "CHALLENGE_NOT_FOUND",
        message: "Challenge expired or unknown",
      });
    }

    await this.waitForIcon(chal);

    const removed = await this.redis.del(key);
    if (!removed) {
      throw new BadRequestException({
        code: "CHALLENGE_NOT_FOUND",
        message: "Challenge expired or unknown",
      });
    }
    return chal;
  }

  async verify(dto: RiotVerifyDto): Promise<AuthTokens> {
    const chal = await this.takeVerifiedChallenge(dto.challengeId);
    const now = new Date();
    const existing = await this.accounts.findOne({ where: { puuid: chal.puuid } });

    let user: User;
    let accountId: string;

    if (existing) {
      const found = await this.users.findOne({ where: { id: existing.userId } });
      if (!found) throw new NotFoundException({ code: "NOT_FOUND" });
      if (found.banned) throw new UnauthorizedException({ code: "ACCOUNT_BANNED" });
      existing.riotId = chal.gameName;
      existing.tagLine = chal.tagLine;
      existing.platform = chal.platform;
      if (dto.lcuPuuid) existing.lcuPuuid = dto.lcuPuuid;
      if (dto.summonerId != null) existing.summonerId = String(dto.summonerId);
      existing.verifiedAt = now;
      existing.lastSeenAt = now;
      const saved = await this.accounts.save(existing);
      accountId = saved.id;
      user = found;
    } else {
      user = await this.users.save(
        this.users.create({ email: null, passwordHash: null })
      );
      const saved = await this.accounts.save(
        this.accounts.create({
          userId: user.id,
          puuid: chal.puuid,
          lcuPuuid: dto.lcuPuuid ?? null,
          riotId: chal.gameName,
          tagLine: chal.tagLine,
          summonerId: dto.summonerId != null ? String(dto.summonerId) : null,
          platform: chal.platform,
          verifiedAt: now,
          lastSeenAt: now,
        })
      );
      accountId = saved.id;
    }

    await this.profileJobs.enqueueRefresh(accountId, "interactive");
    await this.fanout.joinAccountRooms(user.id);
    return this.auth.issueTokens(user);
  }

  private async waitForIcon(chal: RiotChallengePayload): Promise<void> {
    const deadline = Date.now() + ICON_POLL_TIMEOUT_MS;
    for (;;) {
      let summoner;
      try {
        summoner = await this.riot.client.summonerByPuuid(chal.platform, chal.puuid);
      } catch (e) {
        if (e instanceof RiotHttpError) {
          throw new ServiceUnavailableException({
            code: "RIOT_API_UNAVAILABLE",
            message: "Could not verify this account with Riot right now",
          });
        }
        throw e;
      }

      if (summoner.profileIconId === chal.iconId) return;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new BadRequestException({
          code: "ICON_NOT_CHANGED",
          message: "Profile icon was not changed to the challenge icon",
        });
      }
      await this.delay(Math.min(ICON_POLL_MS, remaining));
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private challengeKey(challengeId: string): string {
    return `auth:riotchal:${challengeId}`;
  }

  private assertPlatform(platform: string): string {
    const normalized = platform.toLowerCase();
    if (BLOCKED_PLATFORMS.has(normalized)) {
      throw new ForbiddenException({
        code: "REGION_NOT_SUPPORTED",
        message: "KR region is not supported",
      });
    }
    if (!isKnownPlatform(normalized)) {
      throw new BadRequestException({
        code: "INVALID_PLATFORM",
        message: `Unrecognized platform "${normalized}"`,
      });
    }
    return normalized;
  }

  private mapRiotError(e: unknown, gameName: string, tagLine: string): unknown {
    if (e instanceof RiotHttpError) {
      if (e.status === 404) {
        return new NotFoundException({
          code: "RIOT_ID_NOT_FOUND",
          message: `Riot account ${gameName}#${tagLine} not found`,
        });
      }
      return new ServiceUnavailableException({
        code: "RIOT_API_UNAVAILABLE",
        message: "Could not verify this account with Riot right now",
      });
    }
    return e;
  }
}

function pickChallengeIcon(current: number): number {
  const span = STARTER_ICON_MAX - STARTER_ICON_MIN + 1;
  const currentInPool = current >= STARTER_ICON_MIN && current <= STARTER_ICON_MAX;
  const choices = span - (currentInPool ? 1 : 0);
  let n = randomInt(0, choices);
  if (currentInPool && n >= current) n += 1;
  return n;
}
