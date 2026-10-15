import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString, IsUUID } from "class-validator";

/**
 * Adding another Riot account to the signed-in user.
 * Identity comes from a completed icon challenge, not from a client-supplied
 * gameName/tagLine.
 */
export class LinkRiotAccountDto {
  @IsUUID()
  challengeId!: string;

  /**
   * The League client's local UUID for this account. NOT the Riot Web API
   * PUUID (resolved server-side during the challenge) — stored only so
   * presence heartbeats can identify the logged-in account.
   */
  @IsOptional()
  @IsString()
  lcuPuuid?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summonerId?: number;
}
