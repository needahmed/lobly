import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Block,
  Endorsement,
  GameReport,
  ReliabilityEvent,
  Report,
  RiotAccount,
  Session,
  User,
} from "../../database/entities";
import { ProfileModule } from "../profile/profile.module";
import { MetricsModule } from "../metrics/metrics.module";
import { ReputationController } from "./reputation.controller";
import { ReputationService } from "./reputation.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReliabilityEvent,
      Endorsement,
      Block,
      Report,
      Session,
      RiotAccount,
      User,
      GameReport,
    ]),
    forwardRef(() => ProfileModule),
    MetricsModule,
  ],
  controllers: [ReputationController],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
