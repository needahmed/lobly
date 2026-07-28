import { Controller, Get, Inject } from "@nestjs/common";
import { DataSource } from "typeorm";
import type Redis from "ioredis";
import { Public } from "../../common/decorators/public.decorator";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import { RiotService } from "../riot/riot.service";

@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly riot: RiotService
  ) {}

  @Public()
  @Get("health")
  async health() {
    let db = false;
    let redisOk = false;
    try {
      await this.dataSource.query("SELECT 1");
      db = true;
    } catch {
      db = false;
    }
    try {
      redisOk = (await this.redis.ping()) === "PONG";
    } catch {
      redisOk = false;
    }
    return {
      ok: db && redisOk,
      db,
      redis: redisOk,
      riotKeyLoaded: this.riot.keyLoaded,
    };
  }
}
