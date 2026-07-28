import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { RedisModule } from "./common/redis/redis.module";
import * as entities from "./database/entities";
import { IdentityModule } from "./modules/identity/identity.module";
import { JwtAuthGuard } from "./modules/identity/jwt-auth.guard";
import { RiotModule } from "./modules/riot/riot.module";
import { ProfileModule } from "./modules/profile/profile.module";
import { LobbyModule } from "./modules/lobby/lobby.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { ConfigApiModule } from "./modules/config/config-api.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { ReputationModule } from "./modules/reputation/reputation.module";
import { SessionModule } from "./modules/session/session.module";
import { JoinModule } from "./modules/join/join.module";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "RIOT_API_KEY",
] as const;

function validateEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}

validateEnv();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.getOrThrow<string>("DATABASE_URL"),
        entities: Object.values(entities),
        synchronize: false,
        logging: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    IdentityModule,
    RiotModule,
    ProfileModule,
    LobbyModule,
    MetricsModule,
    ReputationModule,
    SessionModule,
    JoinModule,
    RealtimeModule,
    ConfigApiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
