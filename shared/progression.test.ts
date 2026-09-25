import { describe, expect, it } from "vitest";

import { epley, type ProgressionSet, unmetPrescription } from "./progression";

describe("epley", () => {
  it("estimates 1RM from weight and reps", () => {
    expect(epley(100, 5)).toBeCloseTo(116.6667, 3);
    expect(epley(100, 0)).toBe(100);
  });
});

describe("unmetPrescription", () => {
  it("is null when nothing was prescribed", () => {
    const sets: ProgressionSet[] = [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 100 },
    ];
    expect(unmetPrescription(sets)).toBeNull();
  });

  it("is null when the prescription was met or exceeded", () => {
    const sets: ProgressionSet[] = [
      { reps: 5, weight: 100, plannedReps: 5, plannedWeight: 100 },
      { reps: 6, weight: 102.5, plannedReps: 5, plannedWeight: 100 },
    ];
    expect(unmetPrescription(sets)).toBeNull();
  });

  it("returns the prescription when a set fell short on reps or weight", () => {
    const shortOnReps: ProgressionSet[] = [
      { reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 },
    ];
    expect(unmetPrescription(shortOnReps)).toEqual({ reps: 5, weight: 100 });

    const shortOnWeight: ProgressionSet[] = [
      { reps: 5, weight: 90, plannedReps: 5, plannedWeight: 100 },
    ];
    expect(unmetPrescription(shortOnWeight)).toEqual({ reps: 5, weight: 100 });
  });

  it("treats an unlogged reps/weight as zero rather than throwing", () => {
    const sets: ProgressionSet[] = [{ plannedReps: 5, plannedWeight: 100 }];
    expect(unmetPrescription(sets)).toEqual({ reps: 5, weight: 100 });
  });

  it("is null when the prescription is not uniform across sets", () => {
    const sets: ProgressionSet[] = [
      { reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 },
      { reps: 3, weight: 100, plannedReps: 6, plannedWeight: 100 },
    ];
    expect(unmetPrescription(sets)).toBeNull();
  });

  it("is null when a set has no planned reps/weight at all", () => {
    const sets: ProgressionSet[] = [
      { reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 },
      { reps: 3, weight: 100 },
    ];
    expect(unmetPrescription(sets)).toBeNull();
  });

  // NOT tested: a fallen-short prescription at plannedWeight <= 0 (a
  // bodyweight-only exercise prescribed with no added load). The source
  // returns null there unconditionally, which also suppresses a genuine
  // rep-count miss that doesn't depend on weight at all — the callers
  // (suggestNextTarget's "repeat" path) don't need weight math to repeat a
  // missed rep target, so this reads as an oversight rather than intended
  // behavior. Flagged in the PR instead of pinned as correct: see "Suspected
  // bugs".
});
