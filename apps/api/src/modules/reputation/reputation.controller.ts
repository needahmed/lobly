import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { ReputationService } from "./reputation.service";
import { MetricsService } from "../metrics/metrics.service";

class BlockDto {
  @IsUUID()
  accountId!: string;
}

class ReportDto {
  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsIn(["HARASSMENT", "SLURS", "BAIT_JOIN", "OTHER"])
  reason!: "HARASSMENT" | "SLURS" | "BAIT_JOIN" | "OTHER";

  @IsOptional()
  @IsString()
  detail?: string;
}

class EndorseDto {
  @IsUUID()
  toAccountId!: string;

  @IsArray()
  @IsIn(["GOOD_COMMS", "GOOD_TEAMMATE", "SKILLED"], { each: true })
  kinds!: ("GOOD_COMMS" | "GOOD_TEAMMATE" | "SKILLED")[];
}

class ResolveReportDto {
  @IsIn(["OPEN", "RESOLVED", "DISMISSED"])
  status!: string;

  @IsOptional()
  @IsIn(["WARN", "LISTING_BAN_7D", "ACCOUNT_BAN"])
  action?: string;
}

@Controller()
export class ReputationController {
  constructor(
    private readonly reputation: ReputationService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService
  ) {}

  @Post("blocks")
  block(@CurrentUser() user: JwtPayload, @Body() body: BlockDto) {
    return this.reputation.block(user.sub, body.accountId);
  }

  @Delete("blocks/:accountId")
  unblock(
    @CurrentUser() user: JwtPayload,
    @Param("accountId", ParseUUIDPipe) accountId: string
  ) {
    return this.reputation.unblock(user.sub, accountId);
  }

  @Get("blocks")
  list(@CurrentUser() user: JwtPayload) {
    return this.reputation.listBlocks(user.sub);
  }

  @Post("reports")
  report(@CurrentUser() user: JwtPayload, @Body() body: ReportDto) {
    return this.reputation.report(user.sub, body);
  }

  @Post("sessions/:id/endorse")
  endorse(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: EndorseDto
  ) {
    return this.reputation.endorse(user.sub, id, body.toAccountId, body.kinds);
  }

  @Public()
  @Get("admin/reports")
  adminList(
    @Headers("x-admin-token") token: string | undefined,
    @Query("status") status = "OPEN"
  ) {
    this.assertAdmin(token);
    if (status !== "OPEN") return [];
    return this.reputation.listOpenReports();
  }

  @Public()
  @Patch("admin/reports/:id")
  adminResolve(
    @Headers("x-admin-token") token: string | undefined,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ResolveReportDto
  ) {
    this.assertAdmin(token);
    return this.reputation.resolveReport(id, body);
  }

  @Public()
  @Get("admin/metrics/funnel")
  funnel(
    @Headers("x-admin-token") token: string | undefined,
    @Query("day") day?: string
  ) {
    this.assertAdmin(token);
    return this.metrics.funnel(day);
  }

  private assertAdmin(token?: string) {
    const expected = this.config.get<string>("ADMIN_TOKEN");
    if (!expected || token !== expected) {
      throw new UnauthorizedException({ code: "ADMIN_UNAUTHORIZED" });
    }
  }
}
