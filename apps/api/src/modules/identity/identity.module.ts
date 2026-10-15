import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Block,
  ChampionStat,
  ChatMessage,
  Endorsement,
  JoinRequest,
  Listing,
  MatchSeen,
  ProfileSnapshot,
  ReliabilityEvent,
  Report,
  RiotAccount,
  Session,
  User,
  UserPrefs,
} from "../../database/entities";
import { RiotModule } from "../riot/riot.module";
import { ProfileModule } from "../profile/profile.module";
import { LobbyModule } from "../lobby/lobby.module";
import { JoinModule } from "../join/join.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RiotAccountsController } from "./riot-accounts.controller";
import { RiotAccountsService } from "./riot-accounts.service";
import { RiotAuthService } from "./riot-auth.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      RiotAccount,
      ProfileSnapshot,
      ChampionStat,
      MatchSeen,
      UserPrefs,
      Listing,
      JoinRequest,
      ChatMessage,
      Endorsement,
      Block,
      Report,
      ReliabilityEvent,
      Session,
    ]),
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    RiotModule,
    forwardRef(() => ProfileModule),
    forwardRef(() => LobbyModule),
    forwardRef(() => JoinModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [AuthController, RiotAccountsController, UsersController],
  providers: [
    AuthService,
    RiotAuthService,
    JwtStrategy,
    JwtAuthGuard,
    RiotAccountsService,
    UsersService,
  ],
  exports: [AuthService, RiotAccountsService, JwtAuthGuard, JwtModule],
})
export class IdentityModule {}
