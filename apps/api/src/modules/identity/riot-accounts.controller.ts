import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { LinkRiotAccountDto } from "./dto/link-riot.dto";
import { RiotAccountsService } from "./riot-accounts.service";

@Controller("riot-accounts")
export class RiotAccountsController {
  constructor(private readonly accounts: RiotAccountsService) {}

  @Post("link")
  link(@CurrentUser() user: JwtPayload, @Body() body: LinkRiotAccountDto) {
    return this.accounts.link(user.sub, body);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.accounts.listMine(user.sub);
  }

  @Delete(":id")
  unlink(@CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.accounts.unlink(user.sub, id);
  }
}
