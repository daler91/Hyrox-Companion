import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildDeviceDetails,
  buildWorkoutSummaryStats,
  WorkoutSummaryHeader,
} from "../WorkoutSummaryHeader";

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
  it("summarises a completed workout, measured numbers first", () => {
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

    expect(stats.map((s) => [s.key, s.value, s.unit])).toEqual([
      ["duration", "45", "min"],
      ["distance", "5.0", "km"],
      ["avg-hr", "151", "bpm"],
      ["calories", "480", "kcal"],
      ["rpe", "7/10", undefined],
      ["adherence", "92%", undefined],
    ]);
    const adherence = stats.find((s) => s.key === "adherence");
    // Named as well as coloured.
    expect(adherence?.status).toBe("On plan");
    expect(adherence?.accentClassName).toContain("emerald");
  });

  it("leaves RPE out where the sheet already shows its picker", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ duration: 45, rpe: 7 }),
      variant: "completed",
      rpe: 8,
      distanceUnit: "km",
      showAdherence: false,
      includeRpe: false,
    });

    expect(stats.map((s) => s.key)).toEqual(["duration"]);
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

    expect(stats).toEqual([expect.objectContaining({ key: "distance", value: "1.0", unit: "mi" })]);
  });

  it("shows targets for a planned workout", () => {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ status: "planned", expectedDurationMin: 60, expectedRpe: 6 }),
      variant: "planned",
      distanceUnit: "km",
      showAdherence: false,
    });

    expect(stats.map((s) => [s.key, s.value, s.unit])).toEqual([
      ["target-duration", "~60", "min"],
      ["target-rpe", "~6/10", undefined],
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
      expect.objectContaining({ key: "planned-sets", value: "12", unit: "sets" }),
    ]);
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
      // The compliance is in the status words, not only in the colour.
      expect(avgHr?.label).toBe("Avg HR");
      expect(avgHr?.status).toBe("5 over MAF");
      expect(avgHr?.accentClassName).toContain("rose");
      expect(avgHr?.explanation).toBeTruthy();
    });

    it("tones a run that held under the ceiling", () => {
      const stats = buildWorkoutSummaryStats({
        entry: makeEntry({ avgHeartrate: 138, maxHeartrate: 142, exerciseSets: runSets }),
        variant: "completed",
        distanceUnit: "km",
        showAdherence: false,
        mafCeiling: 145,
      });

      expect(stats.find((s) => s.key === "avg-hr")?.status).toBe("7 under MAF");
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
      expect(avgHr?.status).toBeUndefined();
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
        expect.objectContaining({ label: "Avg HR", value: "150", unit: "bpm" }),
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

describe("buildDeviceDetails", () => {
  const recording = {
    source: "strava",
    stravaActivityId: "9001",
    avgSpeed: 3.05,
    avgCadence: 76.4,
    avgWatts: 370,
    sufferScore: 64,
    calories: 958,
  } as const;

  it("lists the recording's secondary numbers, leaving calories to the stats", () => {
    const details = buildDeviceDetails(makeEntry(recording), "km");

    expect(details.map((d) => [d.key, d.value])).toEqual([
      ["speed", "11 km/h"],
      ["cadence", "76 spm"],
      ["power", "370 W"],
      ["effort", "64"],
    ]);
  });

  it("reads a run as pace rather than speed", () => {
    const details = buildDeviceDetails(
      makeEntry({
        ...recording,
        exerciseSets: [
          { id: "s1", exerciseName: "easy_run", setNumber: 1 },
        ] as TimelineEntry["exerciseSets"],
      }),
      "km",
    );

    expect(details[0]).toEqual({ key: "pace", value: "5:28/km", label: "pace" });
  });

  it("covers a manual log a recording enriched, and nothing without one", () => {
    expect(buildDeviceDetails(makeEntry({ ...recording, source: "manual" }), "km")).toHaveLength(4);
    expect(
      buildDeviceDetails(
        makeEntry({ ...recording, source: "manual", stravaActivityId: null }),
        "km",
      ),
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

  it("names a toned stat's status in words", () => {
    render(
      <WorkoutSummaryHeader
        stats={buildWorkoutSummaryStats({
          entry: makeEntry({ compliancePct: 40 }),
          variant: "completed",
          distanceUnit: "km",
          showAdherence: true,
        })}
      />,
    );

    expect(screen.getByTestId("summary-stat-adherence")).toHaveTextContent("40%Off plan");
  });

  it("lists device details under the stats with their source", () => {
    render(
      <WorkoutSummaryHeader
        stats={[]}
        details={[{ key: "power", value: "370 W", label: "power" }]}
        detailsSource="Strava"
        detailsTestId="details"
      />,
    );

    expect(screen.getByTestId("details")).toHaveTextContent("Strava370 W power");
  });

  it("renders nothing when there are no stats", () => {
    const { container } = render(<WorkoutSummaryHeader stats={[]} testId="summary" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the duration tile's stopped time", () => {
  /** The duration tile for an entry, whatever else the entry carries. */
  function durationStat(overrides: Partial<TimelineEntry>) {
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({ duration: 99, ...overrides }),
      variant: "completed",
      distanceUnit: "km",
      showAdherence: false,
    });
    return stats.find((stat) => stat.key === "duration");
  }

  it("names the duration as moving time when the session held a real stop", () => {
    // The real 16.1 km run: 98m 42s moving inside 2h 09m elapsed.
    const stat = durationStat({ stoppedSeconds: 1816 });
    expect(stat?.label).toBe("Moving time");
    expect(stat?.explanation).toContain("30:16");
  });

  it("leaves the value alone — the stop is context, not a correction", () => {
    // Every other surface shows this same figure; the tile must not start
    // disagreeing with them.
    expect(durationStat({ stoppedSeconds: 1816 })?.value).toBe("99");
    expect(durationStat({ stoppedSeconds: 0 })?.value).toBe("99");
  });

  it("says nothing about a stop too short to be one", () => {
    // A second of GPS settling is not a rest, and captioning every outdoor run
    // for it would be noise.
    const stat = durationStat({ stoppedSeconds: 1 });
    expect(stat?.label).toBe("Duration");
    expect(stat?.explanation).toBeUndefined();
  });

  it("says nothing when the recording cannot tell moving from still", () => {
    // Every non-GPS sport type: the provider reports one clock for both.
    expect(durationStat({ stoppedSeconds: 0 })?.label).toBe("Duration");
    expect(durationStat({ stoppedSeconds: null })?.label).toBe("Duration");
    expect(durationStat({})?.label).toBe("Duration");
  });

  it("keeps the stop from costing another stat its tile", () => {
    // It rides in the label rather than taking a seventh slot, so a fully
    // populated session still shows all six.
    const stats = buildWorkoutSummaryStats({
      entry: makeEntry({
        duration: 99,
        rpe: 7,
        compliancePct: 92,
        distanceMeters: 16_115,
        avgHeartrate: 151,
        calories: 1403,
        stoppedSeconds: 1816,
      }),
      variant: "completed",
      distanceUnit: "km",
      showAdherence: true,
    });
    expect(stats.map((stat) => stat.key)).toEqual([
      "duration",
      "distance",
      "avg-hr",
      "calories",
      "rpe",
      "adherence",
    ]);
  });
});
