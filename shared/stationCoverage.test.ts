import { describe, expect, it } from "vitest";

import {
  buildStationCoverage,
  COVERAGE_STATIONS,
  daysSinceDate,
  stationForExerciseName,
  stationLabel,
  stationsForFreeText,
} from "./stationCoverage";

describe("stationForExerciseName", () => {
  it("maps each of the eight station exercises to itself", () => {
    for (const station of COVERAGE_STATIONS) {
      if (station === "running") continue;
      expect(stationForExerciseName(station)).toBe(station);
    }
  });

  it("counts the erg interval variants toward their station", () => {
    expect(stationForExerciseName("rowing_intervals")).toBe("rowing");
    expect(stationForExerciseName("ski_erg_intervals")).toBe("skierg");
  });

  it("resolves casing and separators through normalizeExerciseName", () => {
    expect(stationForExerciseName("WALL_BALLS")).toBe("wall_balls");
    expect(stationForExerciseName("Sled Push")).toBe("sled_push");
  });

  it("counts every running exercise as running, not just the common four", () => {
    // The coach's old hard-coded set knew easy/tempo/interval/long only, so an
    // athlete doing 1 km repeats read as never having run.
    for (const name of [
      "easy_run",
      "tempo_run",
      "interval_run",
      "long_run",
      "run_1k",
      "recovery_run",
      "hill_repeats",
      "fartlek_run",
      "treadmill_run",
    ]) {
      expect(stationForExerciseName(name)).toBe("running");
    }
  });

  it("returns null for exercises that train no station", () => {
    expect(stationForExerciseName("back_squat")).toBeNull();
    expect(stationForExerciseName("not_an_exercise")).toBeNull();
    expect(stationForExerciseName("")).toBeNull();
  });
});

describe("stationsForFreeText", () => {
  it("finds stations named in prose", () => {
    expect(stationsForFreeText("Sled push + wall balls")).toEqual(
      expect.arrayContaining(["sled_push", "wall_balls"]),
    );
  });

  it("matches spellings normalizeExerciseName cannot resolve", () => {
    // "ski erg" normalises to `ski_erg`, which is neither a definition nor an
    // alias — the keyword scan is the only thing that catches it.
    expect(stationsForFreeText("Ski Erg intervals")).toContain("skierg");
  });

  it("prefers the longer keyword when two overlap", () => {
    expect(stationsForFreeText("sled pull")).toEqual(["sled_pull"]);
  });

  it("returns nothing for unrelated text", () => {
    expect(stationsForFreeText("Upper body push")).toEqual([]);
    expect(stationsForFreeText("")).toEqual([]);
  });
});

describe("stationLabel", () => {
  it("uses the exercise definition's label for the eight stations", () => {
    expect(stationLabel("skierg")).toBe("SkiErg");
    expect(stationLabel("wall_balls")).toBe("Wall Balls");
  });

  it("spells out running, which is not an exercise name", () => {
    expect(stationLabel("running")).toBe("Running");
  });
});

describe("daysSinceDate", () => {
  it("counts whole days", () => {
    expect(daysSinceDate("2026-07-01", "2026-07-08")).toBe(7);
    expect(daysSinceDate("2026-07-08", "2026-07-08")).toBe(0);
  });

  it("returns null for a missing or unparseable date", () => {
    expect(daysSinceDate(null, "2026-07-08")).toBeNull();
    expect(daysSinceDate("not-a-date", "2026-07-08")).toBeNull();
  });
});

describe("buildStationCoverage", () => {
  const today = "2026-07-08";

  it("returns every station in race order with running last", () => {
    const coverage = buildStationCoverage([], today);
    expect(coverage.map((c) => c.station)).toEqual([...COVERAGE_STATIONS]);
    expect(coverage).toHaveLength(9);
  });

  it("reports never-trained stations as null, not zero", () => {
    const [skierg] = buildStationCoverage([], today);
    expect(skierg).toMatchObject({ lastTrained: null, daysSince: null });
  });

  it("keeps the most recent date when a station is trained twice", () => {
    const coverage = buildStationCoverage(
      [
        { date: "2026-07-01", exerciseNames: ["wall_balls"] },
        { date: "2026-07-06", exerciseNames: ["wall_balls"] },
        { date: "2026-07-03", exerciseNames: ["wall_balls"] },
      ],
      today,
    );
    expect(coverage.find((c) => c.station === "wall_balls")).toMatchObject({
      lastTrained: "2026-07-06",
      daysSince: 2,
    });
  });

  it("credits a station named only in the session's free text", () => {
    // The analytics payload never saw focus text before, so a session logged as
    // prose with no parsed sets registered as nothing at all.
    const coverage = buildStationCoverage(
      [{ date: "2026-07-07", exerciseNames: [], freeText: ["Sled push intervals"] }],
      today,
    );
    expect(coverage.find((c) => c.station === "sled_push")).toMatchObject({
      lastTrained: "2026-07-07",
      daysSince: 1,
    });
  });

  it("credits a station named in a custom exercise's label", () => {
    // Guards the behaviour the old substring match gave us for free: a set
    // logged as custom "Heavy sled push finisher" still counts.
    const coverage = buildStationCoverage(
      [{ date: "2026-07-05", exerciseNames: ["custom"], freeText: ["Heavy sled push finisher"] }],
      today,
    );
    expect(coverage.find((c) => c.station === "sled_push")?.lastTrained).toBe("2026-07-05");
  });

  it("ignores sources with no date", () => {
    const coverage = buildStationCoverage([{ date: "", exerciseNames: ["rowing"] }], today);
    expect(coverage.find((c) => c.station === "rowing")?.lastTrained).toBeNull();
  });
});
