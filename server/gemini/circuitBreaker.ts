import { logger } from "../logger";

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
      return;
    }
    throw new CircuitBreakerOpenError();
  }
}

/** Called after a successful request. */
export function recordBreakerSuccess(): void {
  if (state !== "closed") {
    logger.info("[ai] circuit breaker closed");
  }
  state = "closed";
  consecutiveFailures = 0;
  probeInFlight = false;
  clearProbeDeadline();
}

/** Called after a failed request. */
export function recordBreakerFailure(): void {
  if (state === "half-open") {
    state = "open";
    openedAt = Date.now();
    probeInFlight = false;
    clearProbeDeadline();
    logger.warn("[ai] circuit breaker -> open (probe failed)");
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
