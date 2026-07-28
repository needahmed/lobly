import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { SessionService } from "./session.service";

@Controller("sessions")
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get(":id")
  get(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.sessions.get(user.sub, id);
  }

  @Get(":id/messages")
  messages(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.sessions.history(user.sub, id);
  }
}
