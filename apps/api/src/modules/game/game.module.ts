import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameReport, RiotAccount, Session } from "../../database/entities";
import { ConfigApiModule } from "../config/config-api.module";
import { ProfileModule } from "../profile/profile.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SessionModule } from "../session/session.module";
import { POSTGAME_QUEUE } from "./game.constants";
import { GameLifecycleService } from "./game-lifecycle.service";
import { PostgameProcessor } from "./postgame.processor";

@Module({
  imports: [
    TypeOrmModule.forFeature([GameReport, RiotAccount, Session]),
    BullModule.registerQueue({ name: POSTGAME_QUEUE }),
    ConfigApiModule,
    forwardRef(() => ProfileModule),
    forwardRef(() => SessionModule),
    forwardRef(() => RealtimeModule),
  ],
  providers: [GameLifecycleService, PostgameProcessor],
  exports: [GameLifecycleService],
})
export class GameModule {}
