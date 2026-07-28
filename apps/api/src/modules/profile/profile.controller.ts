import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from "@nestjs/common";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { UpdatePrefsDto } from "./dto/prefs.dto";
import { ProfileService } from "./profile.service";
import { MatchHistoryService } from "./match-history.service";

@Controller()
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly history: MatchHistoryService
  ) {}

  @Get("profiles/me")
  me(@CurrentUser() user: JwtPayload) {
    return this.profiles.getMyCards(user.sub);
  }

  @Get("profiles/:riotAccountId")
  one(@Param("riotAccountId", ParseUUIDPipe) riotAccountId: string) {
    return this.profiles.getCard(riotAccountId);
  }

  @Get("profiles/:riotAccountId/matches")
  matches(
    @Param("riotAccountId", ParseUUIDPipe) riotAccountId: string,
    @Query("limit") limit?: string,
    @Query("queueId") queueId?: string
  ) {
    return this.history.list(riotAccountId, {
      limit: limit ? Number(limit) : undefined,
      queueId: queueId ? Number(queueId) : undefined,
    });
  }

  @Put("prefs")
  prefs(@CurrentUser() user: JwtPayload, @Body() body: UpdatePrefsDto) {
    return this.profiles.updatePrefs(user.sub, body);
  }
}
