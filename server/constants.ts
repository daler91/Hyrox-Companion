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

/** Timeout for external HTTP requests (e.g. Strava API) */
export const EXTERNAL_API_TIMEOUT_MS = 15_000;

/**
 * Hard timeout budget for a single AI request (including all retries).
 * Reasoning-model calls on complex prompts routinely take
 * 30-60 seconds. The coach runs in a background pg-boss job so there is
 * no user-facing response waiting on it — prefer giving the model
 * enough time to finish over failing fast. Previous 30s budget was
 * consistently timing out and tripping the circuit breaker before any
 * suggestion or review note could be written.
 */
export const AI_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Timeout for a single AI API call attempt. Matched to the upper end of
 * observed reasoning-model latency on coaching prompts.
 */
export const AI_CALL_TIMEOUT_MS = 90_000;

/**
 * Per-attempt timeout for plan-generation reasoning chunks. These run off the
 * HTTP path inside a pg-boss job (JOB_TIMEOUT_MS = 50min), so they can afford
 * far more than the default 90s AI_CALL_TIMEOUT_MS. The reasoning model takes
 * 60-120+ s per dense 2-week chunk; 90s was killing every call.
 */
export const PLAN_GENERATION_AI_TIMEOUT_MS = 300_000; // 5 minutes

/** Default timeline query limit */
export const DEFAULT_TIMELINE_LIMIT = 500;

/** Default pagination limit for list endpoints */
export const DEFAULT_PAGE_LIMIT = 50;

/** Hard maximum for pagination limit to prevent unbounded reads */
export const MAX_PAGE_LIMIT = 200;

/** Main DB connection timeout (10s to handle cold-start and cross-region latency) */
export const DB_CONNECTION_TIMEOUT_MS = 10_000;

/** Vector/RAG DB connection timeout */
export const VECTOR_DB_CONNECTION_TIMEOUT_MS = 10_000;

/** DB idle timeout */
export const DB_IDLE_TIMEOUT_MS = 30_000;

/** DB statement timeout */
export const DB_STATEMENT_TIMEOUT_MS = 30_000;

/** The 8 functional fitness stations (matches hyrox-style racing) + running */
export const FUNCTIONAL_STATIONS = [
  "skierg", "sled_push", "sled_pull", "burpee_broad_jump",
  "rowing", "farmers_carry", "sandbag_lunges", "wall_balls",
] as const;

export const FUNCTIONAL_STATIONS_WITH_RUNNING = [...FUNCTIONAL_STATIONS, "running"] as const;
