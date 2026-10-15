import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ChatMessage,
  JoinRequest,
  Listing,
  RiotAccount,
  Session,
} from "../../database/entities";
import { LobbyModule } from "../lobby/lobby.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ReputationModule } from "../reputation/reputation.module";
import { MetricsModule } from "../metrics/metrics.module";
import { ProfileModule } from "../profile/profile.module";
import { JoinModule } from "../join/join.module";
import { SessionController } from "./session.controller";
import { SessionService } from "./session.service";
import {
  CHAT_RETENTION_QUEUE,
  ChatRetentionProcessor,
  ChatRetentionService,
} from "./chat-retention.service";
import {
  SESSION_SWEEPER_QUEUE,
  SessionSweeperProcessor,
  SessionSweeperService,
} from "./session-sweeper.service";
import { BullModule } from "@nestjs/bullmq";


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Session,
      ChatMessage,
      Listing,
      RiotAccount,
      JoinRequest,
    ]),
    BullModule.registerQueue({ name: CHAT_RETENTION_QUEUE }),
    BullModule.registerQueue({ name: SESSION_SWEEPER_QUEUE }),
    forwardRef(() => JoinModule),
    forwardRef(() => LobbyModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => ReputationModule),
    MetricsModule,
    ProfileModule,
  ],
  controllers: [SessionController],
  providers: [
    SessionService,
    ChatRetentionService,
    ChatRetentionProcessor,
    SessionSweeperService,
    SessionSweeperProcessor,
  ],
  exports: [SessionService],
})
export class SessionModule {}
