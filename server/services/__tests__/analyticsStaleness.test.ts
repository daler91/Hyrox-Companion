import { describe, expect, it } from "vitest";

import { computeStale } from "../analyticsStaleness";

describe("computeStale", () => {
  it("is not stale when there is no stored row", () => {
    expect(computeStale(undefined, "2026-06-05")).toBe(false);
  });

  it("is stale when a workout exists but the result has no anchor date", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: null }, "2026-06-05")).toBe(true);
  });

  it("is stale when the latest workout is newer than the anchor", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-01" }, "2026-06-05")).toBe(true);
  });

  it("is not stale when the anchor still matches the latest workout", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-05" }, "2026-06-05")).toBe(false);
  });

  it("is not stale when neither an anchor nor a workout exists", () => {
    expect(computeStale({ lastWorkoutDateAtGeneration: null }, null)).toBe(false);
  });

  // --- anchor moved BACKWARD: invisible to the old forward-only compare ---

  it("is stale when the most recent workout was deleted", () => {
    // Anchor was set from a 06-10 workout the athlete has since removed; the
    // stored analysis still reflects it. Previously reported fresh forever.
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-10" }, "2026-06-05")).toBe(true);
  });

  it("is stale when every workout was deleted", () => {
    // The analysis was computed over a history that no longer exists at all.
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-01" }, null)).toBe(true);
  });

  it("is stale when a back-dated import lands entirely before the anchor", () => {
    // Strava's first sync backfills up to 90 days of past-dated activities; if
    // the newest of them predates the anchor the anchor itself does not move
    // forward, but the history the analysis was built on has changed.
    expect(computeStale({ lastWorkoutDateAtGeneration: "2026-06-10" }, "2026-03-20")).toBe(true);
  });
});
