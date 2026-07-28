import type Redis from "ioredis";
import {
  platformHost,
  regionalHost,
  regionForPlatform,
  type RegionalRoute,
} from "./regions";
import {
  DEFAULT_RATE_LIMIT,
  RiotRateLimiter,
  type RateLimitConfig,
} from "./rate-limiter";
import type {
  ChampionMastery,
  LeagueEntry,
  MatchDto,
  RiotAccount,
  RiotSummoner,
} from "./types";

export interface RiotClientOptions {
  apiKey: string;
  redis: Redis;
  rateLimit?: Partial<RateLimitConfig>;
  fetchImpl?: typeof fetch;
}

export class RiotHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "RiotHttpError";
  }
}

export class RiotClient {
  private readonly apiKey: string;
  private readonly limiter: RiotRateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RiotClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.limiter = new RiotRateLimiter(opts.redis, {
      ...DEFAULT_RATE_LIMIT,
      ...opts.rateLimit,
    });
  }

  async accountByPuuid(region: RegionalRoute | string, puuid: string): Promise<RiotAccount> {
    return this.request<RiotAccount>(
      region,
      regionalHost(region),
      `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
    );
  }

  /**
   * Resolves a Riot ID to the real (78-char) PUUID. This is the ONLY way to
   * get a Web-API-usable PUUID from client-side data: the LCU reports a
   * short local UUID that Riot's API rejects with "Exception decrypting".
   */
  async accountByRiotId(
    region: RegionalRoute | string,
    gameName: string,
    tagLine: string
  ): Promise<RiotAccount> {
    return this.request<RiotAccount>(
      region,
      regionalHost(region),
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );
  }

  async summonerByPuuid(platform: string, puuid: string): Promise<RiotSummoner> {
    return this.request<RiotSummoner>(
      platform,
      platformHost(platform),
      `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
    );
  }

  async leagueEntriesByPuuid(platform: string, puuid: string): Promise<LeagueEntry[]> {
    return this.request<LeagueEntry[]>(
      platform,
      platformHost(platform),
      `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
    );
  }

  async matchIdsByPuuid(
    region: RegionalRoute | string,
    puuid: string,
    opts: { startTime?: number; count?: number; start?: number } = {}
  ): Promise<string[]> {
    const params = new URLSearchParams();
    if (opts.startTime != null) params.set("startTime", String(opts.startTime));
    if (opts.count != null) params.set("count", String(opts.count));
    if (opts.start != null) params.set("start", String(opts.start));
    const qs = params.toString();
    return this.request<string[]>(
      region,
      regionalHost(region),
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids${qs ? `?${qs}` : ""}`
    );
  }

  async matchById(region: RegionalRoute | string, matchId: string): Promise<MatchDto> {
    return this.request<MatchDto>(
      region,
      regionalHost(region),
      `/lol/match/v5/matches/${encodeURIComponent(matchId)}`
    );
  }

  async topMasteries(
    platform: string,
    puuid: string,
    count = 10
  ): Promise<ChampionMastery[]> {
    return this.request<ChampionMastery[]>(
      platform,
      platformHost(platform),
      `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=${count}`
    );
  }

  regionForPlatform(platform: string): RegionalRoute {
    return regionForPlatform(platform);
  }

  /**
   * Low-level request with dual-bucket rate limit + 429 Retry-After handling.
   * Never hard-fails on 429; waits and retries.
   */
  async request<T>(bucket: string, host: string, path: string): Promise<T> {
    const url = `${host}${path}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.limiter.acquire(bucket);
      const res = await this.fetchImpl(url, {
        headers: {
          "X-Riot-Token": this.apiKey,
          Accept: "application/json",
        },
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
        const waitMs = Math.max(1000, (Number.isFinite(retryAfter) ? retryAfter : 2) * 1000);
        console.warn(`[riot-client] 429 on ${path}, waiting ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 404) {
        throw new RiotHttpError(404, `Riot 404: ${path}`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new RiotHttpError(res.status, `Riot ${res.status}: ${path} ${body}`.trim());
      }

      return (await res.json()) as T;
    }
    throw new RiotHttpError(429, `Riot rate limit exhausted for ${path}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
