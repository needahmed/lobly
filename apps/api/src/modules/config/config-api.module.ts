import { Module } from "@nestjs/common";
import { LcuConfigController } from "./config.controller";
import { HealthController } from "./health.controller";
import { FlagsService } from "./flags.service";

@Module({
  controllers: [LcuConfigController, HealthController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class ConfigApiModule {}
