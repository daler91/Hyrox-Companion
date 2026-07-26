import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildWorkoutSummaryStats, WorkoutSummaryHeader } from "../WorkoutSummaryHeader";

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-06-10",
    status: "completed",
    source: "manual",
    focus: "Strength",
    mainWorkout: "5x5 squat",
    accessory: null,
    notes: null,
    ...overrides,
  } as TimelineEntry;
}

describe("buildWorkoutSummaryStats", () => {
  it("summarises a completed workout with duration, RPE, adherence and Strava metrics", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({
        duration: 45,
        rpe: 7,
        compliancePct: 92,
        distanceMeters: 5000,
        avgHeartrate: 151.4,
        calories: 480,
      }),
      variant: "completed",
      distanceUnit: "km",
      showAdherence: true,
    });

    expect(stats.map((s) => [s.key, s.value])).toEqual([
      ["duration", "45 min"],
      ["rpe", "7/10"],
      ["adherence", "92%"],
      ["distance", "5.0 km"],
      ["avg-hr", "151 bpm"],
      ["calories", "480 kcal"],
    ]);
    expect(stats.find((s) => s.key === "adherence")?.accentClassName).toContain("emerald");
  });

  it("prefers the live RPE over the entry's stale value", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ rpe: 5 }),
      variant: "completed",
      rpe: 8,
      distanceUnit: "km",
      showAdherence: true,
    });

    expect(stats).toEqual([expect.objectContaining({ key: "rpe", value: "8/10" })]);
  });

  it("hides adherence when the preference is off", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ compliancePct: 70 }),
      variant: "completed",
      distanceUnit: "km",
      showAdherence: false,
    });

    expect(stats).toEqual([]);
  });

  it("converts distance to miles", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ distanceMeters: 1609.34 }),
      variant: "completed",
      distanceUnit: "miles",
      showAdherence: false,
    });

    expect(stats).toEqual([expect.objectContaining({ key: "distance", value: "1.0 mi" })]);
  });

  it("shows targets for a planned workout", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ status: "planned", expectedDurationMin: 60, expectedRpe: 6 }),
      variant: "planned",
      distanceUnit: "km",
      showAdherence: false,
    });

    expect(stats.map((s) => [s.key, s.value])).toEqual([
      ["target-duration", "~60 min"],
      ["target-rpe", "~6/10"],
    ]);
  });

  it("adds the planned set count only for previews", () => {
    const entry = makeEntry({ status: "planned", plannedSetCount: 12 });

    const planned = buildWorkoutSummaryStats({
      entry,
      variant: "planned",
      distanceUnit: "km",
      showAdherence: false,
    });
    const preview = buildWorkoutSummaryStats({
      entry,
      variant: "preview",
      distanceUnit: "km",
      showAdherence: false,
    });

    expect(planned).toEqual([]);
    expect(preview).toEqual([expect.objectContaining({ key: "planned-sets", value: "12 sets" })]);
  });

  describe("the Avg HR tile against a MAF ceiling", () => {
    const runSets = [
      { id: "s1", exerciseName: "easy_run", setNumber: 1 },
    ] as TimelineEntry["exerciseSets"];

    it("tones and labels a run that ran over the ceiling", () => {
      const stats = buildWorkoutSummaryStats({
        entry: makeEntry({ avgHeartrate: 150, maxHeartrate: 165, exerciseSets: runSets }),
        variant: "completed",
        distanceUnit: "km",
        showAdherence: false,
        mafCeiling: 145,
      });

      const avgHr = stats.find((s) => s.key === "avg-hr");
      // The compliance is in the label, not only in the colour.
      expect(avgHr?.label).toBe("Avg HR · 5 over MAF");
      expect(avgHr?.accentClassName).toContain("rose");
      expect(avgHr?.title).toBeTruthy();
    });

    it("tones a run that held under the ceiling", () => {
      const stats = buildWorkoutSummaryStats({
        entry: makeEntry({ avgHeartrate: 138, maxHeartrate: 142, exerciseSets: runSets }),
        variant: "completed",
        distanceUnit: "km",
        showAdherence: false,
        mafCeiling: 145,
      });

      expect(stats.find((s) => s.key === "avg-hr")?.label).toBe("Avg HR · 7 under MAF");
    });

    it("leaves the tile alone on a session that wasn't running", () => {
      // An average of 165 on wall balls is not a MAF violation.
      const stats = buildWorkoutSummaryStats({
        entry: makeEntry({
          avgHeartrate: 165,
          exerciseSets: [
            { id: "s1", exerciseName: "wall_balls", setNumber: 1 },
          ] as TimelineEntry["exerciseSets"],
        }),
        variant: "completed",
        distanceUnit: "km",
        showAdherence: false,
        mafCeiling: 145,
      });

      const avgHr = stats.find((s) => s.key === "avg-hr");
      expect(avgHr?.label).toBe("Avg HR");
      expect(avgHr?.accentClassName).toBeUndefined();
    });

    it("leaves the tile alone for an athlete with no ceiling", () => {
      const stats = buildWorkoutSummaryStats({
        entry: makeEntry({ avgHeartrate: 150, exerciseSets: runSets }),
        variant: "completed",
        distanceUnit: "km",
        showAdherence: false,
      });

      expect(stats.find((s) => s.key === "avg-hr")).toEqual(
        expect.objectContaining({ label: "Avg HR", value: "150 bpm" }),
      );
    });
  });

  it("returns no stats for an entry with nothing to summarise", () => {
    expect(
      buildWorkoutSummaryStats({
        entry: makeEntry(),
        variant: "completed",
        distanceUnit: "km",
        showAdherence: true,
      }),
    ).toEqual([]);
  });
});

describe("WorkoutSummaryHeader", () => {
  it("renders a tile per stat", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ duration: 45, rpe: 7 }),
      variant: "completed",
      distanceUnit: "km",
      showAdherence: true,
    });

    render(<WorkoutSummaryHeader stats={stats} testId="summary" />);

    expect(screen.getByTestId("summary")).toBeInTheDocument();
    expect(screen.getByTestId("summary-stat-duration")).toHaveTextContent("45 min");
    expect(screen.getByTestId("summary-stat-rpe")).toHaveTextContent("7/10");
  });

  it("renders nothing when there are no stats", () => {
    const { container } = render(<WorkoutSummaryHeader stats={[]} testId="summary" />);
    expect(container).toBeEmptyDOMElement();
  });
});
