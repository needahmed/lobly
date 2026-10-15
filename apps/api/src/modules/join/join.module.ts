import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  JoinRequest,
  Listing,
  RiotAccount,
  UserPrefs,
} from "../../database/entities";
import { ProfileModule } from "../profile/profile.module";
import { LobbyModule } from "../lobby/lobby.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ReputationModule } from "../reputation/reputation.module";
import { MetricsModule } from "../metrics/metrics.module";
import { SessionModule } from "../session/session.module";
import { JoinController } from "./join.controller";
import { JOIN_QUEUE } from "./join.constants";
import { JoinService } from "./join.service";
import { JoinProcessor } from "./join.processor";
import { JoinCleanupService } from "./join-cleanup.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([JoinRequest, Listing, RiotAccount, UserPrefs]),
    BullModule.registerQueue({ name: JOIN_QUEUE }),
    ProfileModule,
    forwardRef(() => LobbyModule),
    forwardRef(() => RealtimeModule),
    ReputationModule,
    MetricsModule,
    forwardRef(() => SessionModule),
  ],
  controllers: [JoinController],
  providers: [JoinService, JoinProcessor, JoinCleanupService],
  exports: [JoinService, JoinCleanupService],
})
export class JoinModule {}
