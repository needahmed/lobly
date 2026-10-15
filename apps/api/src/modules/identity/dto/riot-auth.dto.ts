import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class RiotChallengeDto {
  @IsString()
  @MinLength(3)
  gameName!: string;

  @IsString()
  @MinLength(1)
  tagLine!: string;

  @IsString()
  @MinLength(2)
  platform!: string;
}

/**
 * Proves ownership of the Riot account from `POST /auth/riot/challenge`.
 *
 * The server polls Riot `summonerByPuuid` every 3 seconds for up to 60
 * seconds until `profileIconId` equals the icon chosen for this challenge.
 * This request stays open until that match or the deadline. It does not
 * return 202. On timeout the response is
 * `400 { code: "ICON_NOT_CHANGED" }`.
 */
export class RiotVerifyDto {
  @IsUUID()
  challengeId!: string;

  /** League client's local UUID, stored for presence. Not the Web API PUUID. */
  @IsOptional()
  @IsString()
  lcuPuuid?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summonerId?: number;
}
