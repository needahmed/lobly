import { IsNumber, IsOptional, IsString, MinLength } from "class-validator";

export class LinkRiotAccountDto {
  @IsString()
  @MinLength(3)
  gameName!: string;

  @IsString()
  @MinLength(1)
  tagLine!: string;

  @IsString()
  platform!: string;

  /**
   * The League client's local UUID for this account. NOT the Riot Web API
   * PUUID (that one is resolved server-side from gameName#tagLine) — it is
   * stored only so presence heartbeats can identify the logged-in account.
   */
  @IsOptional()
  @IsString()
  lcuPuuid?: string;

  @IsOptional()
  @IsNumber()
  summonerId?: number;
}
