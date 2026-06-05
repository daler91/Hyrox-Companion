import { describe, expect, it } from "vitest";

import { computeStale } from "../analyticsStaleness";

describe("computeStale", () => {
  it("is not stale when there is no stored row", () => {
    expect(computeStale(undefined, "2026-06-05")).toBe(false);
  });

  it("is not stale when the user has no logged workouts", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-01" }, null)).toBe(false);
  });

  it("is stale when a workout exists but the result has no anchor date", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: null }, "2026-06-05")).toBe(true);
  });

  it("is stale when the latest workout is newer than the anchor", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-01" }, "2026-06-05")).toBe(true);
  });

  it("is not stale when the latest workout equals the anchor", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-05" }, "2026-06-05")).toBe(false);
  });

  it("is not stale when the latest workout is older than the anchor", () => {
    // e.g. the anchor was set from a future-dated import; nothing newer since.
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-10" }, "2026-06-05")).toBe(false);
  });
});
