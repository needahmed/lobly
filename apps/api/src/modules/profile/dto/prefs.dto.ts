import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class UpdatePrefsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsIn(["LEAGUE_VOICE", "DISCORD", "NO_VOICE"])
  voice?: "LEAGUE_VOICE" | "DISCORD" | "NO_VOICE";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vibeTags?: string[];

  @IsOptional()
  @IsString()
  discordTag?: string | null;

  @IsOptional()
  @IsIn(["HIDDEN", "ACCEPTED", "PUBLIC"])
  discordReveal?: "HIDDEN" | "ACCEPTED" | "PUBLIC";

  @IsOptional()
  @IsBoolean()
  autoAcceptLoblyInvites?: boolean;
}
