import { describe, expect, it } from "vitest";

import { computeStale, type HistoryAnchor } from "../analyticsStaleness";

/** The athlete's history right now. */
const now = (latestDate: string | null, entryCount: number): HistoryAnchor => ({
  latestDate,
  entryCount,
});

/** What a stored result recorded when it was generated. */
const stored = (lastWorkoutDateAtGeneration: string | null, entryCountAtGeneration: number | null) => ({
  lastWorkoutDateAtGeneration,
  entryCountAtGeneration,
});

describe("computeStale", () => {
  it("is not stale when there is no stored row", () => {
    expect(computeStale(undefined, now("2026-06-05", 12))).toBe(false);
  });

  it("is stale when a workout exists but the result has no anchor date", () => {
    expect(computeStale(stored(null, 0), now("2026-06-05", 1))).toBe(true);
  });

  it("is stale when the latest workout is newer than the anchor", () => {
    expect(computeStale(stored("2026-06-01", 8), now("2026-06-05", 9))).toBe(true);
  });

  it("is not stale when the anchor still matches the latest workout", () => {
    expect(computeStale(stored("2026-06-05", 9), now("2026-06-05", 9))).toBe(false);
  });

  it("is not stale when neither an anchor nor a workout exists", () => {
    expect(computeStale(stored(null, 0), now(null, 0))).toBe(false);
  });

  // --- anchor moved BACKWARD: invisible to a forward-only compare ---

  it("is stale when the most recent workout was deleted", () => {
    // Anchor was set from a 06-10 workout the athlete has since removed; the
    // stored analysis still reflects it. Previously reported fresh forever.
    expect(computeStale(stored("2026-06-10", 9), now("2026-06-05", 8))).toBe(true);
  });

  it("is stale when every workout was deleted", () => {
    // The analysis was computed over a history that no longer exists at all.
    expect(computeStale(stored("2026-06-01", 4), now(null, 0))).toBe(true);
  });

  it("is stale when a back-dated import lands entirely before the anchor", () => {
    // Strava's first sync backfills up to 90 days of past-dated activities; if
    // the newest of them predates the anchor the anchor itself does not move
    // forward, but the history the analysis was built on has changed.
    expect(computeStale(stored("2026-06-10", 9), now("2026-03-20", 40))).toBe(true);
  });
});

describe("changes that leave the date alone (audit L16)", () => {
  it("is stale when a second session is logged on a day that already had one", () => {
    // A morning run and an evening strength session is an ordinary HYROX week,
    // not an edge case. The date does not move for the second one, so the
    // date-only test reported the stored analysis fresh — while the load it was
    // computed from had just gone up by a whole session.
    expect(computeStale(stored("2026-06-05", 9), now("2026-06-05", 10))).toBe(true);
  });

  it("is stale when a workout that is not the latest is deleted", () => {
    // Removing a mis-logged session from three weeks ago leaves the calendar
    // edge exactly where it was.
    expect(computeStale(stored("2026-06-05", 9), now("2026-06-05", 8))).toBe(true);
  });

  it("is stale when one of several workouts on the latest date is deleted", () => {
    // Two sessions on 06-05, one deleted: the date still reads 06-05.
    expect(computeStale(stored("2026-06-05", 10), now("2026-06-05", 9))).toBe(true);
  });

  it("is NOT stale when nothing changed at all", () => {
    // The count must not turn every page load into a recompute.
    expect(computeStale(stored("2026-06-05", 9), now("2026-06-05", 9))).toBe(false);
  });

  it("still cannot see an in-place edit — the known, documented gap", () => {
    // The athlete corrects last Tuesday's squat from 80 kg to 100 kg. Same
    // workout, same day, same row count — a real change to the numbers every
    // stored analysis was computed from, and neither half of the anchor moves.
    const before = { date: "2026-06-05", logs: 9 };
    const afterAnEdit = { date: "2026-06-05", logs: 9 };

    expect(afterAnEdit).toEqual(before); // nothing the anchor can see
    expect(computeStale(stored(before.date, before.logs), now(afterAnEdit.date, afterAnEdit.logs))).toBe(
      false,
    );
    // Pinned deliberately: closing this needs a mutation timestamp, and
    // `workout_logs` has no updated_at column at all. Left as a decision.
  });
});

describe("rows written before the count column existed", () => {
  it("falls back to the date-only test instead of reading null as zero", () => {
    // Every stored result in the database has a null count on the deploy that
    // adds it. Treating null as 0 would mark all of them stale at once and
    // stampede the recompute queue; treating it as "no count recorded" leaves
    // them behaving exactly as they did before, until they next regenerate.
    expect(computeStale(stored("2026-06-05", null), now("2026-06-05", 9))).toBe(false);
  });

  it("still notices a date change on a legacy row", () => {
    expect(computeStale(stored("2026-06-05", null), now("2026-06-06", 10))).toBe(true);
  });

  it("distinguishes a legacy null from an athlete with genuinely zero rows", () => {
    // A recorded 0 is real information: the athlete had nothing logged when the
    // result was generated, so their first workout must mark it stale.
    expect(computeStale(stored(null, 0), now(null, 0))).toBe(false);
    expect(computeStale(stored(null, null), now(null, 0))).toBe(false);
    expect(computeStale(stored("2026-06-05", 0), now("2026-06-05", 1))).toBe(true);
  });
});
