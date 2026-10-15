export const POSTGAME_QUEUE = "postgame";

/** First run is delayed 45s; later failures use these gaps (~16 min total). */
export const POSTGAME_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000];

export const POSTGAME_ATTEMPTS = 6;
export const POSTGAME_FIRST_DELAY_MS = 45_000;

export interface PostgameJobData {
  platform: string;
  gameId: number;
  accountId: string;
  userId: string;
}
