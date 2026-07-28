import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MetricsEvent } from "../../database/entities";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [TypeOrmModule.forFeature([MetricsEvent])],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
