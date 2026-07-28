export type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export type VoicePref = "LEAGUE_VOICE" | "DISCORD" | "NO_VOICE";

export type DiscordReveal = "HIDDEN" | "ACCEPTED" | "PUBLIC";

export interface RankBlock {
  tier: string | null;
  division: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
}

export interface ChampionStat {
  championId: number;
  season: string;
  games: number;
  wins: number;
  kda: number;
  name?: string;
  iconUrl?: string;
}

export interface UserPrefs {
  languages: string[];
  voice: VoicePref;
  vibeTags: string[];
  discordTag: string | null;
  discordReveal: DiscordReveal;
  autoAcceptLoblyInvites: boolean;
}

export interface ProfileSnapshot {
  riotAccountId: string;
  solo: RankBlock;
  flex: RankBlock;
  primaryRole: Role | null;
  secondaryRole: Role | null;
  formWr20: number | null;
  streak: number | null;
  summonerLevel: number | null;
  profileIconId: number | null;
  gamesThisSeason: number | null;
  refreshedAt: string;
}

export interface ProfileCard {
  account: {
    id: string;
    puuid: string;
    riotId: string;
    tagLine: string;
    platform: string;
    summonerId: string | null;
    verifiedAt: string | null;
    lastSeenAt: string | null;
  };
  snapshot: ProfileSnapshot | null;
  champions: ChampionStat[];
  prefs: UserPrefs | null;
  reputation?: {
    reliability: number | null;
    endorsements: {
      goodComms: number;
      goodTeammate: number;
      skilled: number;
    };
    provisional: boolean;
  };
}

export interface UpdatePrefsBody {
  languages?: string[];
  voice?: VoicePref;
  vibeTags?: string[];
  discordTag?: string | null;
  discordReveal?: DiscordReveal;
  autoAcceptLoblyInvites?: boolean;
}
