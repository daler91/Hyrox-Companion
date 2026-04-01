/** Milliseconds in one day (24 * 60 * 60 * 1000) */
export const MS_PER_DAY = 86_400_000;

/** Default rate-limit window for per-endpoint limiters (1 minute) */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Rate-limit window for static/proxy routes (15 minutes) */
export const RATE_LIMIT_WINDOW_15M_MS = 15 * 60 * 1000;

/** Analytics cache time-to-live (5 minutes) */
export const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum age for Strava OAuth state tokens (10 minutes) */
export const STRAVA_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Main DB connection timeout */
export const DB_CONNECTION_TIMEOUT_MS = 5_000;

/** Vector/RAG DB connection timeout */
export const VECTOR_DB_CONNECTION_TIMEOUT_MS = 10_000;

/** DB idle timeout */
export const DB_IDLE_TIMEOUT_MS = 30_000;

/** DB statement timeout */
export const DB_STATEMENT_TIMEOUT_MS = 30_000;

/** The 8 Hyrox functional stations + running */
export const HYROX_STATIONS = [
  "skierg", "sled_push", "sled_pull", "burpee_broad_jump",
  "rowing", "farmers_carry", "sandbag_lunges", "wall_balls",
] as const;

export const HYROX_STATIONS_WITH_RUNNING = [...HYROX_STATIONS, "running"] as const;
