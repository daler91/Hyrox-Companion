import { logger } from "../logger";
import { getRuntimeCache, setRuntimeCache } from "../sharedRuntimeState";
import { AiConfigurationError } from "./errors";
import type { TextAiProviderId } from "./providers/types";

const LOG_CONTEXT = "ai-circuit-breaker";

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
 *
 * One breaker per provider and capability (text, embeddings, vision), not one
 * for the process: a Gemini embedding or vision incident used to cut off a
 * healthy text provider, and the reverse — AI2 (CODEBASE_ANALYSIS_2026-10-03).
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
 * server/maintenance.ts. Each breaker has its own key.
 *
 * TTL is comfortably longer than COOLDOWN_MS so a deploy never loses
 * meaningful state, but expires if the server is down long enough that a
 * stale "open" snapshot would be misleading on restart.
 */
const BREAKER_CACHE_KEY_PREFIX = "ai-circuit-breaker:";
const BREAKER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface BreakerSnapshot {
  state: State;
  consecutiveFailures: number;
  openedAt: number;
}

/**
 * If a half-open probe never resolves (e.g. the AI call hangs and the
 * caller never reaches recordSuccess/recordFailure), `probeInFlight`
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

/**
 * HTTP statuses that mean "this request was wrong", not "this provider is
 * unwell". A 400/404/422 fails identically against a perfectly healthy
 * provider and will fail the same way on the next attempt, so counting one
 * toward the threshold lets a single caller's malformed prompt cut every
 * other feature off from AI.
 *
 * Auth (401/403) and rate limits (429) are deliberately NOT here: a revoked
 * key or an exhausted quota makes the provider unusable for everyone, which
 * is exactly the outage the breaker exists to absorb.
 */
const CALLER_ERROR_STATUSES = new Set([400, 404, 422]);

/** Message fallback for providers that don't attach a status to the error. */
const CALLER_ERROR_PATTERN = /\b(?:400|404|422)\b|invalid[ _-]?request|invalid[ _-]?argument|bad[ _-]?request/i;

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const rec = error as { status?: unknown; statusCode?: unknown };
  if (typeof rec.status === "number") return rec.status;
  if (typeof rec.statusCode === "number") return rec.statusCode;
  return undefined;
}

/**
 * Does this failure carry information about the PROVIDER's health? A call this
 * deployment isn't configured to make never does. Structured status wins; the
 * message is only consulted when there isn't one. An error of unknown shape
 * counts — the breaker's job is to fail safe.
 *
 * Exported for the regression test.
 */
export function isProviderHealthSignal(error: unknown): boolean {
  if (error instanceof AiConfigurationError) return false;
  const status = errorStatus(error);
  if (status !== undefined) return !CALLER_ERROR_STATUSES.has(status);
  if (!(error instanceof Error)) return true;
  return !CALLER_ERROR_PATTERN.test(error.message);
}

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super("AI provider temporarily unavailable (circuit breaker open)");
    this.name = "CircuitBreakerOpenError";
  }
}

export class AiCircuitBreaker {
  private state: State = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  private probeDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

  /** `<capability>:<provider>`, e.g. "text:anthropic"; names its log lines and persisted snapshot. */
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  private get cacheKey(): string {
    return `${BREAKER_CACHE_KEY_PREFIX}${this.name}`;
  }

  /**
   * Fire-and-forget persistence. We deliberately swallow errors here because
   * the breaker must continue to work when the DB is briefly unreachable —
   * the in-memory state is still authoritative; the persisted snapshot is a
   * convenience for surviving restarts. Logged at debug to avoid spamming
   * during a real DB outage (which is also when the breaker fires the most).
   */
  private persistAsync(): void {
    const snapshot: BreakerSnapshot = {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
    setRuntimeCache(this.cacheKey, snapshot, BREAKER_CACHE_TTL_MS).catch((err: unknown) => {
      // The breaker name is a fixed internal identifier, no user data; the
      // error is the cache write's own.
      // bearer:disable javascript_lang_logger_leak
      logger.debug({ err, context: LOG_CONTEXT, breaker: this.name }, "failed to persist circuit-breaker snapshot");
    });
  }

  /**
   * Load any persisted snapshot from a previous process. Silently no-ops on
   * errors or when nothing is cached — defaults already give us the closed
   * state.
   *
   * Half-open is intentionally NOT restored: on a restart, the probe-in-flight
   * machinery (deadline timer, single-flight guard) doesn't exist yet, so
   * treat any persisted "half-open" as "open" and let the next request
   * trigger a fresh probe through the normal cooldown path.
   */
  async restore(): Promise<void> {
    try {
      const snapshot = await getRuntimeCache<BreakerSnapshot>(this.cacheKey);
      if (!snapshot) return;
      this.state = snapshot.state === "half-open" ? "open" : snapshot.state;
      this.consecutiveFailures = snapshot.consecutiveFailures;
      this.openedAt = snapshot.openedAt;
      if (this.state !== "closed") {
        // The breaker name is a fixed internal identifier and the rest is its
        // own state; no user data.
        // bearer:disable javascript_lang_logger_leak
        logger.info(
          {
            context: LOG_CONTEXT,
            breaker: this.name,
            restoredState: this.state,
            consecutiveFailures: this.consecutiveFailures,
            openedAt: this.openedAt,
          },
          "[ai] restored circuit-breaker state from previous process",
        );
      }
    } catch (err) {
      // The only dynamic values are the cache read error itself, which carries
      // no athlete data, and the breaker's constant name.
      // bearer:disable javascript_lang_logger_leak
      logger.warn({ err, context: LOG_CONTEXT, breaker: this.name }, "failed to load persisted breaker state — starting closed");
    }
  }

  private clearProbeDeadline(): void {
    if (this.probeDeadlineTimer) {
      clearTimeout(this.probeDeadlineTimer);
      this.probeDeadlineTimer = null;
    }
  }

  private startProbeDeadline(): void {
    this.clearProbeDeadline();
    this.probeDeadlineTimer = setTimeout(() => {
      this.probeDeadlineTimer = null;
      if (this.probeInFlight) {
        this.probeInFlight = false;
        // `timeoutMs` is a module-level constant and `breaker` a constant
        // name; no PII flows through this log line.
        // bearer:disable javascript_lang_logger_leak
        logger.warn(
          { timeoutMs: PROBE_TIMEOUT_MS, breaker: this.name },
          "[ai] circuit breaker probe deadline reached without success/failure — clearing probeInFlight",
        );
      }
    }, PROBE_TIMEOUT_MS);
    // Don't keep the event loop alive just for this probe-watchdog (matters
    // for graceful shutdown). Typed loosely: outside Node (jsdom, which the
    // tests run under) setTimeout returns a plain number with no unref.
    const timer: { unref?: () => unknown } = this.probeDeadlineTimer;
    timer.unref?.();
  }

  /** Called before a request. Throws if the breaker is currently open. */
  assertClosed(): void {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= COOLDOWN_MS && !this.probeInFlight) {
        this.state = "half-open";
        this.probeInFlight = true;
        this.startProbeDeadline();
        // The breaker name is a fixed internal identifier, no user data.
        // bearer:disable javascript_lang_logger_leak
        logger.info({ breaker: this.name }, "[ai] circuit breaker -> half-open (probe)");
        this.persistAsync();
        return;
      }
      throw new CircuitBreakerOpenError();
    }
  }

  /** Called after a successful request. */
  recordSuccess(): void {
    const wasOpen = this.state !== "closed";
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
    this.clearProbeDeadline();
    if (wasOpen) {
      // The breaker name is a fixed internal identifier, no user data.
      // bearer:disable javascript_lang_logger_leak
      logger.info({ breaker: this.name }, "[ai] circuit breaker closed");
      this.persistAsync();
    }
  }

  /**
   * Called when a request ended without saying anything about the provider: it
   * failed for a caller-side reason, or its caller cancelled it — the athlete's
   * Stop, a stream deadline, a shutdown drain (AI5 (CODEBASE_ANALYSIS_2026-10-03)).
   * Neither a success nor a failure: a half-open probe learned nothing, so it
   * must neither close the breaker nor re-open it. It releases the slot so the
   * next call can still prove recovery instead of leaving the probe wedged until
   * its deadline.
   */
  releaseProbe(): void {
    if (this.state !== "half-open") return;
    this.probeInFlight = false;
    this.clearProbeDeadline();
  }

  /**
   * Called after a failed request. `error` lets the breaker ignore failures that
   * say nothing about the provider (see isProviderHealthSignal); omit it and the
   * failure always counts.
   */
  recordFailure(error?: unknown): void {
    if (!isProviderHealthSignal(error)) {
      this.releaseProbe();
      return;
    }
    if (this.state === "half-open") {
      this.state = "open";
      this.openedAt = Date.now();
      this.probeInFlight = false;
      this.clearProbeDeadline();
      // The breaker name is a fixed internal identifier, no user data.
      // bearer:disable javascript_lang_logger_leak
      logger.warn({ breaker: this.name }, "[ai] circuit breaker -> open (probe failed)");
      this.persistAsync();
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.state = "open";
      this.openedAt = Date.now();
      // The breaker name is a fixed internal identifier and the count its own
      // state; no user data.
      // bearer:disable javascript_lang_logger_leak
      logger.warn(
        { breaker: this.name, consecutiveFailures: this.consecutiveFailures },
        "[ai] circuit breaker -> open (threshold reached)",
      );
      this.persistAsync();
    }
  }

  /** Test-only reset; production code goes through the state machine. */
  resetForTests(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.probeInFlight = false;
    this.clearProbeDeadline();
  }

  /** Test-only reader for the probe-deadline behaviour introduced for W15. */
  probeStateForTests(): { inFlight: boolean; hasDeadlineTimer: boolean } {
    return { inFlight: this.probeInFlight, hasDeadlineTimer: this.probeDeadlineTimer !== null };
  }
}

const geminiTextBreaker = new AiCircuitBreaker("text:gemini");
const anthropicTextBreaker = new AiCircuitBreaker("text:anthropic");
const openAiCompatibleTextBreaker = new AiCircuitBreaker("text:openai-compatible");

/** Gemini embeddings (RAG, semantic food search), whichever text provider is configured. */
export const embeddingBreaker = new AiCircuitBreaker("embedding:gemini");

/** Gemini vision: photo-to-workout, nutrition meal photos and label scans, chat photos. */
export const visionBreaker = new AiCircuitBreaker("vision:gemini");

/** The breaker for text generation through `provider`, streamed or not. */
export function textBreakerFor(provider: TextAiProviderId): AiCircuitBreaker {
  switch (provider) {
    case "gemini":
      return geminiTextBreaker;
    case "anthropic":
      return anthropicTextBreaker;
    case "openai-compatible":
      return openAiCompatibleTextBreaker;
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown text AI provider: ${String(exhaustive)}`);
    }
  }
}

const ALL_BREAKERS: readonly AiCircuitBreaker[] = [
  geminiTextBreaker,
  anthropicTextBreaker,
  openAiCompatibleTextBreaker,
  embeddingBreaker,
  visionBreaker,
];

/**
 * Restore every breaker's persisted snapshot. Called once on startup from
 * server/maintenance.ts; never throws (each restore swallows its own errors).
 */
export async function loadPersistedBreakerState(): Promise<void> {
  await Promise.all(ALL_BREAKERS.map((breaker) => breaker.restore()));
}

/** Test-only reset of every breaker. Keep exported separately so production code cannot reset. */
export function __resetCircuitBreakerForTests(): void {
  for (const breaker of ALL_BREAKERS) breaker.resetForTests();
}

/** Test-only constants for the probe-deadline behaviour introduced for W15. */
export const __circuitBreakerInternalsForTests = {
  PROBE_TIMEOUT_MS,
} as const;
