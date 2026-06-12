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

    expect(stats).toEqual([
      expect.objectContaining({ key: "rpe", value: "8/10" }),
    ]);
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

    expect(stats).toEqual([
      expect.objectContaining({ key: "distance", value: "1.0 mi" }),
    ]);
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
    expect(preview).toEqual([
      expect.objectContaining({ key: "planned-sets", value: "12 sets" }),
    ]);
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
