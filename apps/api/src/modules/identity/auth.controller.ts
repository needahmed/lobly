import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "./auth.service";
import { RiotAuthService } from "./riot-auth.service";
import { LoginDto, RefreshDto, RegisterDto } from "./dto/auth.dto";
import { RiotChallengeDto, RiotVerifyDto } from "./dto/riot-auth.dto";

@Controller("auth")
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly riotAuth: RiotAuthService
  ) {}

  @Public()
  @Post("register")
  register(@Body() body: RegisterDto) {
    return this.auth.register(body.email, body.password);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  logout(@Body() body: RefreshDto) {
    return this.auth.logout(body.refreshToken);
  }

  @Public()
  @Post("riot/challenge")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  riotChallenge(@Body() body: RiotChallengeDto) {
    return this.riotAuth.createChallenge(body);
  }

  @Public()
  @Post("riot/verify")
  @HttpCode(200)
  riotVerify(@Body() body: RiotVerifyDto) {
    return this.riotAuth.verify(body);
  }
}
