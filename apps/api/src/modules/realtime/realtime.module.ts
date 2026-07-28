import { Module, forwardRef } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { LobbyModule } from "../lobby/lobby.module";
import { JoinModule } from "../join/join.module";
import { SessionModule } from "../session/session.module";
import { PresenceService } from "./presence.service";
import { RealtimeFanoutService } from "./realtime-fanout.service";
import { SyncGateway } from "./sync.gateway";

@Module({
  imports: [
    forwardRef(() => LobbyModule),
    forwardRef(() => IdentityModule),
    forwardRef(() => JoinModule),
    forwardRef(() => SessionModule),
  ],
  providers: [SyncGateway, PresenceService, RealtimeFanoutService],
  exports: [RealtimeFanoutService, PresenceService],
})
export class RealtimeModule {}
