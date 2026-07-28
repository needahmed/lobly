import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { RiotClient } from "@lobly/riot-client";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";

@Injectable()
export class RiotService implements OnModuleInit {
  private _client!: RiotClient;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  onModuleInit() {
    const apiKey = this.config.getOrThrow<string>("RIOT_API_KEY");
    this._client = new RiotClient({
      apiKey,
      redis: this.redis,
      rateLimit: {
        shortMax: Number(this.config.get("RIOT_SHORT_MAX") ?? 20),
        shortWindowMs: Number(this.config.get("RIOT_SHORT_WINDOW_MS") ?? 1000),
        longMax: Number(this.config.get("RIOT_LONG_MAX") ?? 100),
        longWindowMs: Number(this.config.get("RIOT_LONG_WINDOW_MS") ?? 120_000),
      },
    });
  }

  get client(): RiotClient {
    return this._client;
  }

  get keyLoaded(): boolean {
    const key = this.config.get<string>("RIOT_API_KEY");
    return Boolean(key && key.length > 8 && !key.includes("your-dev-key"));
  }
}
