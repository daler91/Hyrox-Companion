import {
  getRaceReference,
  HYROX_STATION_ORDER,
  RACE_RUN_LEGS,
} from "@shared/raceSpec";
import { describe, expect, it } from "vitest";

import type { LoggedExerciseSetWithDate } from "../../storage/shared";
import { buildRacePredictionFeatures } from "./featureBuilder";

function set(
  exerciseName: string,
  fields: {
    time?: number | null;
    weight?: number | null;
    distance?: number | null;
    reps?: number | null;
    date?: string;
  },
): LoggedExerciseSetWithDate {
  return {
    exerciseName,
    time: fields.time ?? null,
    weight: fields.weight ?? null,
    distance: fields.distance ?? null,
    reps: fields.reps ?? null,
    date: fields.date ?? "2026-05-01",
  } as unknown as LoggedExerciseSetWithDate;
}

const NOW = new Date("2026-05-30T00:00:00Z");

function expectedBenchmarkFinish(division: "open" | "pro", gender: "male" | "female"): number {
  const ref = getRaceReference(division, gender);
  const stations = HYROX_STATION_ORDER.reduce((sum, s) => sum + ref.stations[s].benchmarkSeconds, 0);
  return RACE_RUN_LEGS * ref.runKmBenchmarkSeconds + stations;
}

describe("buildRacePredictionFeatures", () => {
  it("falls back entirely to benchmarks with no logged data", () => {
    const features = buildRacePredictionFeatures([], {
      division: "open",
      gender: "male",
      weightUnit: "kg",
    });

    expect(features.dataCompleteness).toEqual({
      stationsWithData: 0,
      totalStations: 8,
      hasRunData: false,
    });
    expect(features.baselineSegments).toHaveLength(16);
    expect(features.baselineSegments.every((s) => s.basis === "benchmark")).toBe(true);
    expect(features.deterministicFinishSeconds).toBe(expectedBenchmarkFinish("open", "male"));
  });

  it("uses logged run_1k median (in seconds) for run legs", () => {
    const features = buildRacePredictionFeatures(
      [
        set("run_1k", { time: 4, date: "2026-05-20" }), // 240s
        set("run_1k", { time: 5, date: "2026-05-22" }), // 300s
      ],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );

    expect(features.runFeature.sampleSize).toBe(2);
    expect(features.runFeature.bestSeconds).toBe(240);
    expect(features.runFeature.medianSeconds).toBe(270); // mean of 240 & 300
    expect(features.dataCompleteness.hasRunData).toBe(true);

    const runSegments = features.baselineSegments.filter((s) => s.kind === "run");
    expect(runSegments).toHaveLength(8);
    expect(runSegments.every((s) => s.estimatedSeconds === 270 && s.basis === "logged")).toBe(true);
  });

  it("computes loadRatio from the standard converted into the athlete's unit", () => {
    // Open male wall ball = 6 kg. Athlete logs in lbs at ~13.2 lbs (≈ 6 kg).
    const standardKg = getRaceReference("open", "male").stations.wall_balls.loadKg!;
    const features = buildRacePredictionFeatures(
      [set("wall_balls", { time: 5, weight: standardKg * 2.20462, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "lbs" },
      NOW,
    );

    const wallBalls = features.stationFeatures.wall_balls;
    expect(wallBalls.standardLoadUserUnit).toBeCloseTo(standardKg * 2.20462, 1);
    expect(wallBalls.loadRatio).toBeCloseTo(1, 2);
  });

  it("slows the estimate when trained lighter than standard, speeds it when heavier", () => {
    const standardKg = getRaceReference("open", "male").stations.wall_balls.loadKg!; // 6

    const lighter = buildRacePredictionFeatures(
      [set("wall_balls", { time: 5, weight: standardKg / 2, date: "2026-05-20" })], // ratio 0.5
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    const heavier = buildRacePredictionFeatures(
      [set("wall_balls", { time: 5, weight: standardKg * 2, date: "2026-05-20" })], // ratio 2
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );

    const lighterWallBalls = lighter.baselineSegments.find((s) => s.exerciseName === "wall_balls")!;
    const heavierWallBalls = heavier.baselineSegments.find((s) => s.exerciseName === "wall_balls")!;
    expect(lighterWallBalls.estimatedSeconds).toBeGreaterThan(300); // 5 min logged → slower
    expect(heavierWallBalls.estimatedSeconds).toBeLessThan(300); // → faster
  });

  it("flags genderAssumed and uses a blended reference when gender is withheld", () => {
    const features = buildRacePredictionFeatures([], {
      division: "open",
      gender: null,
      weightUnit: "kg",
    });
    expect(features.genderAssumed).toBe(true);
    expect(features.resolvedGender).toBeNull();
  });

  it("computes recency from the most recent logged set", () => {
    const features = buildRacePredictionFeatures(
      [
        set("sled_push", { time: 3, date: "2026-05-10" }),
        set("sled_push", { time: 3, date: "2026-05-25" }),
      ],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.sled_push.lastTrainedDaysAgo).toBe(5); // 2026-05-25 → 2026-05-30
  });

  it("normalizes a partial distance-based interval up to the full race station", () => {
    // A 250 m SkiErg interval in 1:00 → projected to the full 1000 m: 4:00.
    const features = buildRacePredictionFeatures(
      [set("skierg", { time: 1, distance: 250, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.skierg.medianSeconds).toBe(240); // 60s * (1000/250)
  });

  it("normalizes a partial rep-based set up to the full race station", () => {
    // 50 wall balls in 2:30 → projected to the race's 100 reps: 5:00.
    const features = buildRacePredictionFeatures(
      [set("wall_balls", { time: 2.5, reps: 50, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.wall_balls.medianSeconds).toBe(300); // 150s * (100/50)
  });

  it("floors an impossibly fast logged split in the deterministic baseline", () => {
    // A 0:48 SkiErg logged without a distance must not surface as a 1000 m split.
    const features = buildRacePredictionFeatures(
      [set("skierg", { time: 0.8, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    const ski = features.baselineSegments.find((s) => s.exerciseName === "skierg");
    expect(ski?.basis).toBe("logged");
    expect(ski?.estimatedSeconds).toBe(180); // floored to the world-class minimum
    expect(ski?.floorSeconds).toBe(180);
  });
});
