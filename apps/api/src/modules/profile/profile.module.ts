import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ChampionStat,
  JoinRequest,
  Match,
  MatchParticipation,
  MatchSeen,
  ProfileSnapshot,
  RiotAccount,
  Session,
  UserPrefs,
} from "../../database/entities";
import {
  PROFILE_BACKGROUND_QUEUE,
  PROFILE_INTERACTIVE_QUEUE,
  ProfileJobsService,
} from "./profile-jobs.service";
import {
  ProfileBackgroundProcessor,
  ProfileInteractiveProcessor,
} from "./profile-refresh.processor";
import { ProfileRefreshService } from "./profile-refresh.service";
import { ProfileService } from "./profile.service";
import { ProfileController } from "./profile.controller";
import { ChampionsService } from "./champions.service";
import { ChampionsController } from "./champions.controller";
import { MatchHistoryService } from "./match-history.service";
import { ReputationModule } from "../reputation/reputation.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiotAccount,
      ProfileSnapshot,
      ChampionStat,
      MatchSeen,
      Match,
      MatchParticipation,
      UserPrefs,
      Session,
      JoinRequest,
    ]),
    BullModule.registerQueue(
      { name: PROFILE_INTERACTIVE_QUEUE },
      { name: PROFILE_BACKGROUND_QUEUE }
    ),
    forwardRef(() => ReputationModule),
  ],
  controllers: [ProfileController, ChampionsController],
  providers: [
    ProfileService,
    ProfileJobsService,
    ProfileRefreshService,
    ProfileInteractiveProcessor,
    ProfileBackgroundProcessor,
    ChampionsService,
    MatchHistoryService,
  ],
  exports: [
    ProfileService,
    ProfileJobsService,
    ProfileRefreshService,
    ChampionsService,
    MatchHistoryService,
  ],
})
export class ProfileModule {}
