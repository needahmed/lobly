import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { ListingStatus } from "@lobly/shared-types";
import { Listing } from "../../database/entities";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";

@Injectable()
export class BoardCacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>
  ) {}

  private key(platform: string): string {
    return `board:candidates:${platform}`;
  }

  async invalidate(platform: string, _queueId?: number): Promise<void> {
    await this.redis.del(this.key(platform));
  }

  async getCandidateIds(platform: string, queueId?: number): Promise<string[]> {
    const all = await this.loadPlatform(platform);
    if (queueId == null) return all;

    // Filter by queue in-memory via a lightweight second query of ids→queueId
    const rows = await this.listings.find({
      where: { id: In(all.length ? all : ["00000000-0000-0000-0000-000000000000"]) },
      select: ["id", "queueId"],
    });
    return rows.filter((r) => r.queueId === queueId).map((r) => r.id);
  }

  private async loadPlatform(platform: string): Promise<string[]> {
    const k = this.key(platform);
    const cached = await this.redis.get(k);
    if (cached) return JSON.parse(cached) as string[];

    const rows = await this.listings.find({
      where: {
        platform,
        status: In([ListingStatus.LISTED, ListingStatus.FILLING]),
      },
      select: ["id", "expiresAt", "slots"],
    });

    const now = Date.now();
    const ids = rows
      .filter(
        (r) =>
          r.expiresAt.getTime() > now &&
          Array.isArray(r.slots) &&
          r.slots.some((s) => s.open)
      )
      .map((r) => r.id);

    await this.redis.set(k, JSON.stringify(ids), "EX", 30);
    return ids;
  }
}
