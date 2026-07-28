import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FeatureFlags } from "@lobly/shared-types";

@Injectable()
export class FlagsService {
  constructor(private readonly config: ConfigService) {}

  getFlags(): FeatureFlags {
    // Empty / unset = all platforms allowed. Set ALLOWED_PLATFORMS=euw1,me1
    // to restrict during staged rollouts.
    const platforms = (this.config.get<string>("ALLOWED_PLATFORMS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      inviteAutomation: this.config.get<string>("FLAG_INVITE_AUTOMATION") !== "false",
      autoAccept: this.config.get<string>("FLAG_AUTO_ACCEPT") !== "false",
      board: this.config.get<string>("FLAG_BOARD") !== "false",
      allowedPlatforms: platforms,
    };
  }
}
