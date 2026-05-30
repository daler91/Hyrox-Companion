import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __circuitBreakerInternalsForTests,
  __resetCircuitBreakerForTests,
  assertBreakerClosed,
  CircuitBreakerOpenError,
  recordBreakerFailure,
  recordBreakerSuccess,
} from "./circuitBreaker";

describe("circuit breaker", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
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
    function openBreaker(): void {
      for (let i = 0; i < 5; i += 1) recordBreakerFailure();
    }

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
});
