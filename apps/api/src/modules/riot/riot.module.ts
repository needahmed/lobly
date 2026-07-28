import { Global, Module } from "@nestjs/common";
import { RiotService } from "./riot.service";

@Global()
@Module({
  providers: [RiotService],
  exports: [RiotService],
})
export class RiotModule {}
