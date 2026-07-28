import type Redis from "ioredis";

/**
 * Dual token-bucket rate limiter (dev key defaults: 20/1s + 100/120s).
 * Uses a Redis Lua script so concurrent API instances share one budget.
 */
const LUA = `
local short_key = KEYS[1]
local long_key = KEYS[2]
local short_max = tonumber(ARGV[1])
local short_window_ms = tonumber(ARGV[2])
local long_max = tonumber(ARGV[3])
local long_window_ms = tonumber(ARGV[4])
local now = tonumber(ARGV[5])

local function take(key, max, window)
  local data = redis.call('HMGET', key, 'tokens', 'ts')
  local tokens = tonumber(data[1])
  local ts = tonumber(data[2])
  if tokens == nil then
    tokens = max
    ts = now
  end
  local elapsed = now - ts
  local refill = (elapsed / window) * max
  tokens = math.min(max, tokens + refill)
  if tokens < 1 then
    local wait = math.ceil((1 - tokens) * window / max)
    return {0, wait}
  end
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
  redis.call('PEXPIRE', key, window * 2)
  return {1, 0}
end

local short = take(short_key, short_max, short_window_ms)
if short[1] == 0 then
  return short
end
local long = take(long_key, long_max, long_window_ms)
if long[1] == 0 then
  -- refund short token (best-effort)
  redis.call('HINCRBYFLOAT', short_key, 'tokens', 1)
  return long
end
return {1, 0}
`;

export interface RateLimitConfig {
  shortMax: number;
  shortWindowMs: number;
  longMax: number;
  longWindowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  shortMax: 20,
  shortWindowMs: 1000,
  longMax: 100,
  longWindowMs: 120_000,
};

export class RiotRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT
  ) {}

  /** Wait until a token is available for `bucket` (usually a region name). */
  async acquire(bucket: string): Promise<void> {
    for (;;) {
      const shortKey = `riot:rl:${bucket}:s`;
      const longKey = `riot:rl:${bucket}:l`;
      const now = Date.now();
      const result = (await this.redis.eval(
        LUA,
        2,
        shortKey,
        longKey,
        this.config.shortMax,
        this.config.shortWindowMs,
        this.config.longMax,
        this.config.longWindowMs,
        now
      )) as [number, number];

      if (result[0] === 1) return;
      const waitMs = Math.max(50, Number(result[1]) || 50);
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
