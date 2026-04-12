import { logger } from "../logger";

/**
 * Minimal circuit breaker for outbound Gemini calls.
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

type State = "closed" | "open" | "half-open";

let state: State = "closed";
let consecutiveFailures = 0;
let openedAt = 0;
let probeInFlight = false;

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super("Gemini temporarily unavailable (circuit breaker open)");
    this.name = "CircuitBreakerOpenError";
  }
}

/** Called before a request. Throws if the breaker is currently open. */
export function assertBreakerClosed(): void {
  if (state === "open") {
    if (Date.now() - openedAt >= COOLDOWN_MS && !probeInFlight) {
      state = "half-open";
      probeInFlight = true;
      logger.info("[gemini] circuit breaker → half-open (probe)");
      return;
    }
    throw new CircuitBreakerOpenError();
  }
}

/** Called after a successful request. */
export function recordBreakerSuccess(): void {
  if (state !== "closed") {
    logger.info({ prevState: state }, "[gemini] circuit breaker → closed");
  }
  state = "closed";
  consecutiveFailures = 0;
  probeInFlight = false;
}

/** Called after a failed request. */
export function recordBreakerFailure(): void {
  if (state === "half-open") {
    state = "open";
    openedAt = Date.now();
    probeInFlight = false;
    logger.warn("[gemini] circuit breaker → open (probe failed)");
    return;
  }
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    state = "open";
    openedAt = Date.now();
    logger.warn(
      { consecutiveFailures },
      "[gemini] circuit breaker → open (threshold reached)",
    );
  }
}

/** Test-only reset. Keep exported separately so production code cannot reset. */
export function __resetCircuitBreakerForTests(): void {
  state = "closed";
  consecutiveFailures = 0;
  openedAt = 0;
  probeInFlight = false;
}
