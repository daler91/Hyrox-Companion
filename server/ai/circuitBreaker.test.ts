import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared cache so tests don't touch a real DB pool. Returns null
// from getRuntimeCache by default (no persisted state); individual W20 tests
// override the resolved value to exercise the restore path.
const mockGetRuntimeCache = vi.fn().mockResolvedValue(undefined);
const mockSetRuntimeCache = vi.fn().mockResolvedValue(undefined);
vi.mock("../sharedRuntimeState", () => ({
  getRuntimeCache: (key: string) => mockGetRuntimeCache(key),
  setRuntimeCache: (key: string, value: unknown, ttl: number) => mockSetRuntimeCache(key, value, ttl),
}));

import {
  __circuitBreakerInternalsForTests,
  __resetCircuitBreakerForTests,
  CircuitBreakerOpenError,
  embeddingBreaker,
  isProviderHealthSignal,
  loadPersistedBreakerState,
  textBreakerFor,
  visionBreaker,
} from "./circuitBreaker";
import { AiConfigurationError } from "./errors";

// The state machine is the same for every breaker; these tests drive one.
const breaker = textBreakerFor("anthropic");
const BREAKER_KEY = "ai-circuit-breaker:text:anthropic";

// Trip the breaker open by exhausting the failure threshold (5 consecutive).
function openBreaker(): void {
  for (let i = 0; i < 5; i += 1) breaker.recordFailure();
}

const isProbeInFlight = () => breaker.probeStateForTests().inFlight;
const hasProbeDeadlineTimer = () => breaker.probeStateForTests().hasDeadlineTimer;

describe("circuit breaker", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
    mockGetRuntimeCache.mockReset().mockResolvedValue(undefined);
    mockSetRuntimeCache.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCircuitBreakerForTests();
  });

  describe("baseline behaviour", () => {
    it("passes calls through while closed", () => {
      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });

    it("opens after FAILURE_THRESHOLD consecutive failures", () => {
      for (let i = 0; i < 5; i += 1) breaker.recordFailure();
      expect(() => { breaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);
    });

    it("resets the failure counter on a success", () => {
      for (let i = 0; i < 4; i += 1) breaker.recordFailure();
      breaker.recordSuccess();
      // 4 fresh failures should NOT trip — counter was reset.
      for (let i = 0; i < 4; i += 1) breaker.recordFailure();
      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });
  });

  describe("what counts as a provider-health failure", () => {
    it("ignores a request the provider rejected as malformed, however many times", () => {
      // One caller's bad prompt must not cut every other feature off from AI:
      // a 400 fails the same way against a perfectly healthy provider.
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure(Object.assign(new Error("invalid request"), { status: 400 }));
      }

      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });

    it("counts an auth failure, which does make the provider unusable for everyone", () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure(Object.assign(new Error("unauthorized"), { status: 401 }));
      }

      expect(() => { breaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);
    });

    it("reads the message when the provider attaches no status", () => {
      expect(isProviderHealthSignal(new Error("400 Bad Request: unknown field"))).toBe(false);
      expect(isProviderHealthSignal(new Error("500 Internal Server Error"))).toBe(true);
      // Rate limits and auth are health signals, not caller errors.
      expect(isProviderHealthSignal(new Error("429 Too Many Requests"))).toBe(true);
      // Unknown shapes count — the breaker fails safe.
      expect(isProviderHealthSignal("something odd")).toBe(true);
      expect(isProviderHealthSignal(undefined)).toBe(true);
    });

    // AI2 (CODEBASE_ANALYSIS_2026-10-03): a deployment with no Gemini key, or
    // with AI switched off, fails every call however healthy the provider is.
    it("never counts a configuration error, however many times", () => {
      const missingKey = new AiConfigurationError("GEMINI_API_KEY is required for AI features");
      expect(isProviderHealthSignal(missingKey)).toBe(false);

      for (let i = 0; i < 10; i++) breaker.recordFailure(missingKey);

      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });

    it("releases a half-open probe that failed for a caller-side reason", () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure(new Error("503"));
      vi.advanceTimersByTime(30_000); // COOLDOWN_MS
      breaker.assertClosed(); // -> half-open, probe in flight
      expect(isProbeInFlight()).toBe(true);

      breaker.recordFailure(Object.assign(new Error("invalid request"), { status: 422 }));

      // The probe learned nothing, so it neither closed nor re-opened the
      // breaker — but it must not stay wedged either.
      expect(isProbeInFlight()).toBe(false);
      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });

    it("releases a half-open probe its caller cancelled, and otherwise changes nothing (AI5)", () => {
      for (let i = 0; i < 4; i++) breaker.recordFailure(new Error("503"));
      breaker.releaseProbe();
      // Closed: the run of failures neither grew nor reset.
      breaker.recordFailure(new Error("503"));
      expect(() => { breaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);

      vi.advanceTimersByTime(30_000); // COOLDOWN_MS
      breaker.assertClosed(); // -> half-open, probe in flight
      breaker.releaseProbe();

      expect(isProbeInFlight()).toBe(false);
      expect(hasProbeDeadlineTimer()).toBe(false);
      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });
  });

  // AI2 (CODEBASE_ANALYSIS_2026-10-03): one breaker for the whole process let
  // a Gemini embedding or vision incident cut off a healthy text provider.
  describe("one breaker per provider and capability", () => {
    it("keeps the text provider open for business while embeddings are failing", () => {
      for (let i = 0; i < 5; i++) embeddingBreaker.recordFailure(new Error("503 Service Unavailable"));

      expect(() => { embeddingBreaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);
      expect(() => { textBreakerFor("anthropic").assertClosed(); }).not.toThrow();
      expect(() => { textBreakerFor("gemini").assertClosed(); }).not.toThrow();
      expect(() => { visionBreaker.assertClosed(); }).not.toThrow();
    });

    it("keeps embeddings and vision working while the text provider is failing", () => {
      for (let i = 0; i < 5; i++) textBreakerFor("gemini").recordFailure(new Error("503 Service Unavailable"));

      expect(() => { textBreakerFor("gemini").assertClosed(); }).toThrow(CircuitBreakerOpenError);
      expect(() => { embeddingBreaker.assertClosed(); }).not.toThrow();
      expect(() => { visionBreaker.assertClosed(); }).not.toThrow();
    });

    it("gives each text provider its own breaker", () => {
      expect(textBreakerFor("gemini")).not.toBe(textBreakerFor("anthropic"));
      expect(textBreakerFor("anthropic")).not.toBe(textBreakerFor("openai-compatible"));
      expect(textBreakerFor("anthropic")).toBe(textBreakerFor("anthropic"));
    });
  });

  describe("half-open probe deadline (W15)", () => {
    it("starts a deadline timer when transitioning to half-open", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001); // past COOLDOWN_MS
      expect(() => { breaker.assertClosed(); }).not.toThrow();
      expect(isProbeInFlight()).toBe(true);
      expect(hasProbeDeadlineTimer()).toBe(true);
    });

    it("clears probeInFlight if the probe never resolves before PROBE_TIMEOUT_MS", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed();
      expect(isProbeInFlight()).toBe(true);

      // Probe never calls recordSuccess/recordFailure — let the deadline fire.
      vi.advanceTimersByTime(__circuitBreakerInternalsForTests.PROBE_TIMEOUT_MS + 1);

      expect(isProbeInFlight()).toBe(false);
      expect(hasProbeDeadlineTimer()).toBe(false);
    });

    it("clears the deadline timer on recordSuccess", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed();
      expect(hasProbeDeadlineTimer()).toBe(true);

      breaker.recordSuccess();

      expect(hasProbeDeadlineTimer()).toBe(false);
      expect(isProbeInFlight()).toBe(false);
    });

    it("clears the deadline timer on recordFailure (probe failed)", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed();
      expect(hasProbeDeadlineTimer()).toBe(true);

      breaker.recordFailure();

      expect(hasProbeDeadlineTimer()).toBe(false);
      expect(isProbeInFlight()).toBe(false);
    });

    it("allows the next probe to fire after the deadline cleared the stuck flag", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed(); // first probe — never resolves
      vi.advanceTimersByTime(__circuitBreakerInternalsForTests.PROBE_TIMEOUT_MS + 1);
      expect(isProbeInFlight()).toBe(false);

      // Re-opens by calling failure (would have happened if the wedged probe
      // ever did fail), then waits another cooldown.
      breaker.recordFailure();
      vi.advanceTimersByTime(30_001);

      // Without the deadline fix this would have thrown because probeInFlight
      // would still be stuck true from the first probe.
      expect(() => { breaker.assertClosed(); }).not.toThrow();
      expect(isProbeInFlight()).toBe(true);
    });
  });

  describe("persistence (W20)", () => {
    it("persists a snapshot when the breaker opens via threshold", () => {
      openBreaker();
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        BREAKER_KEY,
        expect.objectContaining({ state: "open", consecutiveFailures: 5 }),
        expect.any(Number),
      );
    });

    it("persists a snapshot when transitioning open → half-open", () => {
      openBreaker();
      mockSetRuntimeCache.mockClear();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed(); // transition to half-open
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        BREAKER_KEY,
        expect.objectContaining({ state: "half-open" }),
        expect.any(Number),
      );
    });

    it("persists a snapshot when half-open probe fails (back to open)", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed();
      mockSetRuntimeCache.mockClear();
      breaker.recordFailure();
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        BREAKER_KEY,
        expect.objectContaining({ state: "open" }),
        expect.any(Number),
      );
    });

    it("persists a snapshot when a successful probe closes the breaker", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      breaker.assertClosed();
      mockSetRuntimeCache.mockClear();
      breaker.recordSuccess();
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        BREAKER_KEY,
        expect.objectContaining({ state: "closed", consecutiveFailures: 0 }),
        expect.any(Number),
      );
    });

    it("does NOT persist a snapshot on a routine in-closed-state success", () => {
      mockSetRuntimeCache.mockClear();
      breaker.recordSuccess(); // breaker was already closed
      expect(mockSetRuntimeCache).not.toHaveBeenCalled();
    });

    it("loadPersistedBreakerState restores an open snapshot", async () => {
      mockGetRuntimeCache.mockResolvedValue({
        state: "open",
        consecutiveFailures: 5,
        openedAt: Date.now() - 1000, // recent — still within cooldown
      });

      await loadPersistedBreakerState();

      // Throws because state is restored to open and we're within cooldown.
      expect(() => { breaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);
    });

    it("loadPersistedBreakerState downgrades half-open → open on restore", async () => {
      // A "half-open" snapshot from a previous process is meaningless on a
      // fresh boot because the probe-in-flight + deadline timer don't carry
      // across. We treat it as "open" so the next request triggers a fresh
      // probe via the normal cooldown path.
      mockGetRuntimeCache.mockResolvedValue({
        state: "half-open",
        consecutiveFailures: 5,
        openedAt: Date.now() - 1000,
      });

      await loadPersistedBreakerState();

      expect(() => { breaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);
    });

    it("persists and restores each breaker under its own key", async () => {
      for (let i = 0; i < 5; i++) embeddingBreaker.recordFailure(new Error("503"));
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        "ai-circuit-breaker:embedding:gemini",
        expect.objectContaining({ state: "open" }),
        expect.any(Number),
      );
      expect(mockSetRuntimeCache).not.toHaveBeenCalledWith(BREAKER_KEY, expect.anything(), expect.anything());

      __resetCircuitBreakerForTests();
      const openSnapshot = { state: "open", consecutiveFailures: 5, openedAt: Date.now() - 1000 };
      mockGetRuntimeCache.mockImplementation((key: string) =>
        Promise.resolve(key === "ai-circuit-breaker:embedding:gemini" ? openSnapshot : undefined),
      );

      await loadPersistedBreakerState();

      expect(() => { embeddingBreaker.assertClosed(); }).toThrow(CircuitBreakerOpenError);
      expect(() => { breaker.assertClosed(); }).not.toThrow();
      expect(() => { visionBreaker.assertClosed(); }).not.toThrow();
    });

    it("loadPersistedBreakerState no-ops on empty cache", async () => {
      mockGetRuntimeCache.mockResolvedValue(undefined);
      await loadPersistedBreakerState();
      // Default state is "closed" — calls pass through.
      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });

    it("loadPersistedBreakerState swallows cache errors and stays closed", async () => {
      mockGetRuntimeCache.mockRejectedValue(new Error("db unreachable"));
      await expect(loadPersistedBreakerState()).resolves.toBeUndefined();
      expect(() => { breaker.assertClosed(); }).not.toThrow();
    });
  });
});
