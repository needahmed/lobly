import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ChampionStat,
  JoinRequest,
  Listing,
  ProfileSnapshot,
  RiotAccount,
  User,
  UserPrefs,
} from "../../database/entities";
import { ProfileModule } from "../profile/profile.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { MetricsModule } from "../metrics/metrics.module";
import { ReputationModule } from "../reputation/reputation.module";
import { ConfigApiModule } from "../config/config-api.module";
import { JoinModule } from "../join/join.module";
import { BoardCacheService } from "./board-cache.service";
import { BoardController } from "./board.controller";
import { BoardService } from "./board.service";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";
import { SWEEPER_QUEUE, SweepersService } from "./sweepers.service";
import { SweepersProcessor } from "./sweepers.processor";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Listing,
      JoinRequest,
      RiotAccount,
      ProfileSnapshot,
      UserPrefs,
      ChampionStat,
      User,
    ]),
    BullModule.registerQueue({ name: SWEEPER_QUEUE }),
    ProfileModule,
    MetricsModule,
    ConfigApiModule,
    forwardRef(() => ReputationModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => JoinModule),
  ],
  controllers: [ListingsController, BoardController],
  providers: [
    ListingsService,
    BoardService,
    BoardCacheService,
    SweepersService,
    SweepersProcessor,
  ],
  exports: [ListingsService, BoardService, BoardCacheService],
})
export class LobbyModule {}
