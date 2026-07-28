export const ENV = {
  DEV: true,
  PROD: false,
} as const;

export const BACKEND_URL = ENV.DEV
  ? "http://localhost:8790"
  : "https://api.lobly.app"; // Phase 2/3

export const SYNC_NAMESPACE = "/sync";

export const HEARTBEAT_MS = 30_000;
