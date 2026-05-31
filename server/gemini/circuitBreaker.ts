import { logger } from "../logger";
import { getRuntimeCache, setRuntimeCache } from "../sharedRuntimeState";

/**
 * Minimal circuit breaker for outbound AI provider calls.
 *
 * Rationale (CODEBASE_AUDIT.md §5): retryWithBackoff already survives
 * transient failures, but during a prolonged provider outage every caller
 * still walks its full retry budget. That amplifies latency and queues
 * upstream work. The breaker short-circuits requests once a run of
 * consecutive failures is observed and automatically probes recovery on a
 * cooldown timer.
 *
 * States:
 *   closed    → calls pass through; failures increment a counter
 *   open      → calls fail fast until COOLDOWN_MS elapses
 *   half-open → a single probe call is allowed; success closes the
 *               breaker, failure re-opens it for another cooldown
 */

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;

/**
 * Persistence (W20): without a backing store the breaker resets to "closed"
 * on every process restart, so a deploy mid-outage would amplify load on a
 * struggling upstream by clearing all the warm-up backpressure the breaker
 * had built up. We snapshot the durable state fields (state /
 * consecutiveFailures / openedAt — the probe-in-flight + timer are
 * instance-local and intentionally not persisted) to server_runtime_cache
 * on every transition and restore them on startup from
 * server/maintenance.ts.
 *
 * TTL is comfortably longer than COOLDOWN_MS so a deploy never loses
 * meaningful state, but expires if the server is down long enough that a
 * stale "open" snapshot would be misleading on restart.
 */
const BREAKER_CACHE_KEY = "ai-circuit-breaker:state";
const BREAKER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface BreakerSnapshot {
  state: State;
  consecutiveFailures: number;
  openedAt: number;
}

/**
 * If a half-open probe never resolves (e.g. the AI call hangs and the
 * caller never reaches recordBreakerSuccess/Failure), `probeInFlight`
 * stays true forever and the breaker can't half-open again on the next
 * cooldown window — it stays stuck open until process restart (W15).
 *
 * 10 seconds is far below COOLDOWN_MS so a wedged probe self-heals well
 * before the next cooldown attempt. The deadline is best-effort: if the
 * wrapped call eventually does call record*, the deadlined-out probe is
 * effectively a no-op (state is already "closed" or "open").
 */
const PROBE_TIMEOUT_MS = 10_000;

type State = "closed" | "open" | "half-open";

let state: State = "closed";
let consecutiveFailures = 0;
let openedAt = 0;
let probeInFlight = false;
let probeDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget persistence. We deliberately swallow errors here because
 * the breaker must continue to work when the DB is briefly unreachable —
 * the in-memory state is still authoritative; the persisted snapshot is a
 * convenience for surviving restarts. Logged at debug to avoid spamming
 * during a real DB outage (which is also when the breaker fires the most).
 */
function persistBreakerStateAsync(): void {
  const snapshot: BreakerSnapshot = { state, consecutiveFailures, openedAt };
  setRuntimeCache(BREAKER_CACHE_KEY, snapshot, BREAKER_CACHE_TTL_MS).catch((err) => {
    logger.debug({ err, context: "ai-circuit-breaker" }, "failed to persist circuit-breaker snapshot");
  });
}

/**
 * Load any persisted snapshot from a previous process. Called once on
 * startup from server/maintenance.ts. Silently no-ops on errors or when
 * nothing is cached — defaults already give us the closed state.
 *
 * Half-open is intentionally NOT restored: on a restart, the probe-in-flight
 * machinery (deadline timer, single-flight guard) doesn't exist yet, so
 * treat any persisted "half-open" as "open" and let the next request
 * trigger a fresh probe through the normal cooldown path.
 */
export async function loadPersistedBreakerState(): Promise<void> {
  try {
    const snapshot = await getRuntimeCache<BreakerSnapshot>(BREAKER_CACHE_KEY);
    if (!snapshot) return;
    state = snapshot.state === "half-open" ? "open" : snapshot.state;
    consecutiveFailures = snapshot.consecutiveFailures;
    openedAt = snapshot.openedAt;
    if (state !== "closed") {
      logger.info(
        { context: "ai-circuit-breaker", restoredState: state, consecutiveFailures, openedAt },
        "[ai] restored circuit-breaker state from previous process",
      );
    }
  } catch (err) {
    logger.warn({ err, context: "ai-circuit-breaker" }, "failed to load persisted breaker state — starting closed");
  }
}

function clearProbeDeadline(): void {
  if (probeDeadlineTimer) {
    clearTimeout(probeDeadlineTimer);
    probeDeadlineTimer = null;
  }
}

function startProbeDeadline(): void {
  clearProbeDeadline();
  probeDeadlineTimer = setTimeout(() => {
    probeDeadlineTimer = null;
    if (probeInFlight) {
      probeInFlight = false;
      // bearer:disable javascript_lang_logger_leak — `timeoutMs` is a
      // module-level constant; no PII flows through this log line.
      logger.warn(
        { timeoutMs: PROBE_TIMEOUT_MS },
        "[ai] circuit breaker probe deadline reached without success/failure — clearing probeInFlight",
      );
    }
  }, PROBE_TIMEOUT_MS);
  // Don't keep the event loop alive just for this probe-watchdog (matters
  // for graceful shutdown — unref returns the timer untyped on some Node
  // versions, hence the optional-chain).
  probeDeadlineTimer.unref?.();
}

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super("AI provider temporarily unavailable (circuit breaker open)");
    this.name = "CircuitBreakerOpenError";
  }
}

/** Called before a request. Throws if the breaker is currently open. */
export function assertBreakerClosed(): void {
  if (state === "open") {
    if (Date.now() - openedAt >= COOLDOWN_MS && !probeInFlight) {
      state = "half-open";
      probeInFlight = true;
      startProbeDeadline();
      logger.info("[ai] circuit breaker -> half-open (probe)");
      persistBreakerStateAsync();
      return;
    }
    throw new CircuitBreakerOpenError();
  }
}

/** Called after a successful request. */
export function recordBreakerSuccess(): void {
  const wasOpen = state !== "closed";
  state = "closed";
  consecutiveFailures = 0;
  probeInFlight = false;
  clearProbeDeadline();
  if (wasOpen) {
    logger.info("[ai] circuit breaker closed");
    persistBreakerStateAsync();
  }
}

/** Called after a failed request. */
export function recordBreakerFailure(): void {
  if (state === "half-open") {
    state = "open";
    openedAt = Date.now();
    probeInFlight = false;
    clearProbeDeadline();
    logger.warn("[ai] circuit breaker -> open (probe failed)");
    persistBreakerStateAsync();
    return;
  }
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    state = "open";
    openedAt = Date.now();
    logger.warn(
      { consecutiveFailures },
      "[ai] circuit breaker -> open (threshold reached)",
    );
    persistBreakerStateAsync();
  }
}

/** Test-only reset. Keep exported separately so production code cannot reset. */
export function __resetCircuitBreakerForTests(): void {
  state = "closed";
  consecutiveFailures = 0;
  openedAt = 0;
  probeInFlight = false;
  clearProbeDeadline();
}

/** Test-only readers for the probe-deadline behavior introduced for W15. */
export const __circuitBreakerInternalsForTests = {
  isProbeInFlight: () => probeInFlight,
  hasProbeDeadlineTimer: () => probeDeadlineTimer !== null,
  PROBE_TIMEOUT_MS,
} as const;
