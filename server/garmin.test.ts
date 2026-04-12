import { afterEach,describe, expect, it } from "vitest";

import { __testing } from "./garmin";

const { garminCircuitBreaker, inFlightUsers, GLOBAL_429_COOLDOWN_MS } = __testing;

afterEach(() => {
  garminCircuitBreaker._resetForTests();
  inFlightUsers.clear();
});

describe("garmin safety layers", () => {
  describe("garminCircuitBreaker", () => {
    it("starts closed", () => {
      expect(garminCircuitBreaker.isOpen()).toBe(false);
      expect(garminCircuitBreaker.remainingMs()).toBe(0);
    });

    it("opens for the configured cooldown after trip()", () => {
      garminCircuitBreaker.trip("test");
      expect(garminCircuitBreaker.isOpen()).toBe(true);
      expect(garminCircuitBreaker.remainingMs()).toBeGreaterThan(0);
      // Use a generous tolerance to avoid flakes — we just want to confirm
      // the cooldown is in the right ballpark, not exact-ms accuracy.
      expect(garminCircuitBreaker.remainingMs()).toBeLessThanOrEqual(GLOBAL_429_COOLDOWN_MS);
      expect(garminCircuitBreaker.remainingMs()).toBeGreaterThan(GLOBAL_429_COOLDOWN_MS - 5_000);
    });

    it("resets cleanly", () => {
      garminCircuitBreaker.trip("test");
      garminCircuitBreaker._resetForTests();
      expect(garminCircuitBreaker.isOpen()).toBe(false);
      expect(garminCircuitBreaker.remainingMs()).toBe(0);
    });
  });

  describe("inFlightUsers mutex", () => {
    it("starts empty", () => {
      expect(inFlightUsers.size).toBe(0);
    });

    it("tracks per-user lock state", () => {
      inFlightUsers.add("user-1");
      expect(inFlightUsers.has("user-1")).toBe(true);
      expect(inFlightUsers.has("user-2")).toBe(false);

      inFlightUsers.add("user-2");
      expect(inFlightUsers.size).toBe(2);

      inFlightUsers.delete("user-1");
      expect(inFlightUsers.has("user-1")).toBe(false);
      expect(inFlightUsers.has("user-2")).toBe(true);
    });
  });

  describe("safety constants", () => {
    it("uses a generous global cooldown to outlast Garmin's IP ban window", () => {
      // The official python-garminconnect advice is "wait 60 seconds" — we
      // wait much longer because we don't know how widely the ban applies.
      expect(__testing.GLOBAL_429_COOLDOWN_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
    });

    it("enforces a minimum sync interval to prevent click-spam", () => {
      expect(__testing.MIN_SYNC_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 1000);
    });

    it("keeps the per-sync activity cap small", () => {
      // Each sync pulls this many activities. Larger pages = more bytes,
      // more chance of triggering anti-abuse heuristics.
      expect(__testing.GARMIN_ACTIVITIES_PER_SYNC).toBeLessThanOrEqual(30);
    });

    it("leaves a wide buffer before token expiry", () => {
      expect(__testing.TOKEN_EXPIRY_BUFFER_MS).toBeGreaterThanOrEqual(60 * 1000);
    });
  });
});
