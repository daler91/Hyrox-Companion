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
  assertBreakerClosed,
  CircuitBreakerOpenError,
  loadPersistedBreakerState,
  recordBreakerFailure,
  recordBreakerSuccess,
} from "./circuitBreaker";

// Trip the breaker open by exhausting the failure threshold (5 consecutive).
function openBreaker(): void {
  for (let i = 0; i < 5; i += 1) recordBreakerFailure();
}

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
      expect(() => assertBreakerClosed()).not.toThrow();
    });

    it("opens after FAILURE_THRESHOLD consecutive failures", () => {
      for (let i = 0; i < 5; i += 1) recordBreakerFailure();
      expect(() => assertBreakerClosed()).toThrow(CircuitBreakerOpenError);
    });

    it("resets the failure counter on a success", () => {
      for (let i = 0; i < 4; i += 1) recordBreakerFailure();
      recordBreakerSuccess();
      // 4 fresh failures should NOT trip — counter was reset.
      for (let i = 0; i < 4; i += 1) recordBreakerFailure();
      expect(() => assertBreakerClosed()).not.toThrow();
    });
  });

  describe("half-open probe deadline (W15)", () => {
    it("starts a deadline timer when transitioning to half-open", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001); // past COOLDOWN_MS
      expect(() => assertBreakerClosed()).not.toThrow();
      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(true);
      expect(__circuitBreakerInternalsForTests.hasProbeDeadlineTimer()).toBe(true);
    });

    it("clears probeInFlight if the probe never resolves before PROBE_TIMEOUT_MS", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed();
      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(true);

      // Probe never calls recordBreakerSuccess/Failure — let the deadline fire.
      vi.advanceTimersByTime(__circuitBreakerInternalsForTests.PROBE_TIMEOUT_MS + 1);

      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(false);
      expect(__circuitBreakerInternalsForTests.hasProbeDeadlineTimer()).toBe(false);
    });

    it("clears the deadline timer on recordBreakerSuccess", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed();
      expect(__circuitBreakerInternalsForTests.hasProbeDeadlineTimer()).toBe(true);

      recordBreakerSuccess();

      expect(__circuitBreakerInternalsForTests.hasProbeDeadlineTimer()).toBe(false);
      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(false);
    });

    it("clears the deadline timer on recordBreakerFailure (probe failed)", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed();
      expect(__circuitBreakerInternalsForTests.hasProbeDeadlineTimer()).toBe(true);

      recordBreakerFailure();

      expect(__circuitBreakerInternalsForTests.hasProbeDeadlineTimer()).toBe(false);
      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(false);
    });

    it("allows the next probe to fire after the deadline cleared the stuck flag", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed(); // first probe — never resolves
      vi.advanceTimersByTime(__circuitBreakerInternalsForTests.PROBE_TIMEOUT_MS + 1);
      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(false);

      // Re-opens by calling failure (would have happened if the wedged probe
      // ever did fail), then waits another cooldown.
      recordBreakerFailure();
      vi.advanceTimersByTime(30_001);

      // Without the deadline fix this would have thrown because probeInFlight
      // would still be stuck true from the first probe.
      expect(() => assertBreakerClosed()).not.toThrow();
      expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(true);
    });
  });

  describe("persistence (W20)", () => {
    it("persists a snapshot when the breaker opens via threshold", () => {
      openBreaker();
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        "ai-circuit-breaker:state",
        expect.objectContaining({ state: "open", consecutiveFailures: 5 }),
        expect.any(Number),
      );
    });

    it("persists a snapshot when transitioning open → half-open", () => {
      openBreaker();
      mockSetRuntimeCache.mockClear();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed(); // transition to half-open
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        "ai-circuit-breaker:state",
        expect.objectContaining({ state: "half-open" }),
        expect.any(Number),
      );
    });

    it("persists a snapshot when half-open probe fails (back to open)", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed();
      mockSetRuntimeCache.mockClear();
      recordBreakerFailure();
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        "ai-circuit-breaker:state",
        expect.objectContaining({ state: "open" }),
        expect.any(Number),
      );
    });

    it("persists a snapshot when a successful probe closes the breaker", () => {
      openBreaker();
      vi.advanceTimersByTime(30_001);
      assertBreakerClosed();
      mockSetRuntimeCache.mockClear();
      recordBreakerSuccess();
      expect(mockSetRuntimeCache).toHaveBeenCalledWith(
        "ai-circuit-breaker:state",
        expect.objectContaining({ state: "closed", consecutiveFailures: 0 }),
        expect.any(Number),
      );
    });

    it("does NOT persist a snapshot on a routine in-closed-state success", () => {
      mockSetRuntimeCache.mockClear();
      recordBreakerSuccess(); // breaker was already closed
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
      expect(() => assertBreakerClosed()).toThrow(CircuitBreakerOpenError);
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

      expect(() => assertBreakerClosed()).toThrow(CircuitBreakerOpenError);
    });

    it("loadPersistedBreakerState no-ops on empty cache", async () => {
      mockGetRuntimeCache.mockResolvedValue(undefined);
      await loadPersistedBreakerState();
      // Default state is "closed" — calls pass through.
      expect(() => assertBreakerClosed()).not.toThrow();
    });

    it("loadPersistedBreakerState swallows cache errors and stays closed", async () => {
      mockGetRuntimeCache.mockRejectedValue(new Error("db unreachable"));
      await expect(loadPersistedBreakerState()).resolves.toBeUndefined();
      expect(() => assertBreakerClosed()).not.toThrow();
    });
  });
});
