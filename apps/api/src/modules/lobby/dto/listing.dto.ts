import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;
const DIVISIONS = ["IV", "III", "II", "I"] as const;

class SlotDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsArray()
  @IsIn([...ROLES], { each: true })
  @ArrayMaxSize(5)
  roles!: (typeof ROLES)[number][];

  @IsBoolean()
  open!: boolean;
}

class FiltersDto {
  @IsOptional()
  @IsIn([...TIERS])
  minTier?: string;

  @IsOptional()
  @IsIn([...DIVISIONS])
  minDivision?: string;

  @IsOptional()
  @IsIn([...TIERS])
  maxTier?: string;

  @IsOptional()
  @IsIn([...DIVISIONS])
  maxDivision?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  minGames?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minReliability?: number;

  @IsOptional()
  @IsBoolean()
  allowUnranked?: boolean;
}

class QueueMetaDto {
  @IsInt()
  queueId!: number;

  @IsOptional()
  @IsString()
  gameMode?: string | null;

  @IsOptional()
  @IsNumber()
  mapId?: number | null;

  @IsInt()
  @Min(1)
  @Max(10)
  maxLobbySize!: number;

  @IsBoolean()
  positional!: boolean;

  @IsBoolean()
  isCustom!: boolean;

  @ValidateIf((_, v) => v != null)
  @IsIn(["solo", "flex"])
  rankSource?: "solo" | "flex" | null;

  @IsBoolean()
  duoRules!: boolean;
}

export class CreateListingDto {
  @IsUUID()
  riotAccountId!: string;

  @IsInt()
  queueId!: number;

  @IsIn(["POSITIONAL", "OPEN", "DUO", "FLEX", "ARAM"])
  type!: "POSITIONAL" | "OPEN" | "DUO" | "FLEX" | "ARAM";

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots!: SlotDto[];

  @ValidateNested()
  @Type(() => FiltersDto)
  filters!: FiltersDto;

  @IsBoolean()
  voiceRequired!: boolean;

  @IsArray()
  @IsString({ each: true })
  languages!: string[];

  @IsInt()
  @IsIn([15, 30, 60])
  durationMin!: 15 | 30 | 60;

  @IsOptional()
  @ValidateNested()
  @Type(() => QueueMetaDto)
  queueMeta?: QueueMetaDto;
}

export class PatchListingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FiltersDto)
  filters?: FiltersDto;

  @IsOptional()
  @IsInt()
  @IsIn([15, 30, 60])
  durationMin?: 15 | 30 | 60;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots?: SlotDto[];

  @IsOptional()
  @IsBoolean()
  voiceRequired?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];
}

class PartyMemberDto {
  @IsString()
  @MaxLength(80)
  puuid!: string;

  @IsInt()
  summonerId!: number;

  @IsArray()
  @ArrayMaxSize(5)
  @IsIn([...ROLES], { each: true })
  roles!: (typeof ROLES)[number][];

  @IsBoolean()
  isLeader!: boolean;
}

export class ReconcilePartyDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  partyId?: string | null;

  @IsInt()
  queueId!: number;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PartyMemberDto)
  members!: PartyMemberDto[];

  @IsArray()
  @ArrayMaxSize(5)
  @IsIn([...ROLES], { each: true })
  filledRoles!: (typeof ROLES)[number][];

  @IsString()
  @MaxLength(40)
  phase!: string;
}

export class ListingStateDto {
  @IsIn(["pause", "relist", "delist", "ready", "reopen"])
  event!: "pause" | "relist" | "delist" | "ready" | "reopen";

  @IsOptional()
  @IsString()
  phase?: string;
}
