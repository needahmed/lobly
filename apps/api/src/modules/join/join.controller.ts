import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { JoinService } from "./join.service";

class JoinDto {
  @IsOptional()
  @IsString()
  roleSlot?: string;
}

class InviteResultDto {
  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsString()
  error?: string;
}

@Controller()
export class JoinController {
  constructor(private readonly joins: JoinService) {}

  @Post("listings/:id/join")
  join(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: JoinDto,
    @Headers("idempotency-key") idem?: string
  ) {
    return this.joins.requestJoin(user.sub, id, body.roleSlot, idem);
  }

  @Get("listings/:id/requests")
  requests(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.joins.listForListing(user.sub, id);
  }

  @Post("join-requests/:id/accept")
  accept(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.joins.accept(user.sub, id);
  }

  @Post("join-requests/:id/decline")
  decline(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.joins.decline(user.sub, id);
  }

  @Post("join-requests/:id/invite-result")
  inviteResult(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: InviteResultDto
  ) {
    return this.joins.inviteResult(user.sub, id, body);
  }

  @Post("join-requests/:id/cancel")
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.joins.cancel(user.sub, id);
  }
}
