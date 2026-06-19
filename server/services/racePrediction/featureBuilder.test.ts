import { getRaceReference, HYROX_STATION_ORDER } from "@shared/raceSpec";
import { describe, expect, it } from "vitest";

import type { LoggedExerciseSetWithDate } from "../../storage/shared";
import { buildRacePredictionFeatures, MIN_PERSONAL_FRACTION } from "./featureBuilder";

// Each set defaults to its own workoutLogId (one set = one session) so prior
// expectations hold; tests exercising session de-duplication pass a shared
// workoutLogId explicitly.
let setSeq = 0;
function set(
  exerciseName: string,
  fields: {
    time?: number | null;
    weight?: number | null;
    distance?: number | null;
    reps?: number | null;
    date?: string;
    workoutLogId?: string;
  },
): LoggedExerciseSetWithDate {
  return {
    exerciseName,
    workoutLogId: fields.workoutLogId ?? `log-${setSeq++}`,
    time: fields.time ?? null,
    weight: fields.weight ?? null,
    distance: fields.distance ?? null,
    reps: fields.reps ?? null,
    date: fields.date ?? "2026-05-01",
  } as unknown as LoggedExerciseSetWithDate;
}

const NOW = new Date("2026-05-30T00:00:00Z");

// SkiErg station feature built from three full-station splits (240/252/270s);
// the caller assigns each split's session (workoutLogId) + date to exercise the
// session-grouping logic.
function skiergSessionFeature(splits: Array<{ workoutLogId: string; date: string }>) {
  const times = [4, 4.2, 4.5];
  const sets = splits.map((s, i) =>
    set("skierg", { time: times[i], distance: 1000, date: s.date, workoutLogId: s.workoutLogId }),
  );
  return buildRacePredictionFeatures(
    sets,
    { division: "open", gender: "male", weightUnit: "kg" },
    NOW,
  ).stationFeatures.skierg;
}

function expectedBenchmarkFinish(division: "open" | "pro", gender: "male" | "female"): number {
  const ref = getRaceReference(division, gender);
  const stations = HYROX_STATION_ORDER.reduce(
    (sum, s) => sum + ref.stations[s].benchmarkSeconds,
    0,
  );
  const runs = ref.runLegBenchmarkSeconds.reduce((sum, v) => sum + v, 0);
  // Finish now includes the modeled transition (roxzone) total.
  return runs + stations + ref.transitionTotalSeconds;
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
    expect(runSegments.every((s) => s.basis === "logged")).toBe(true);
    // Race runs are anchored to real pacing: slower on average than the athlete's
    // FRESH 1 km median (fatigue), not faster than it.
    const runMean = runSegments.reduce((t, s) => t + s.estimatedSeconds, 0) / runSegments.length;
    expect(runMean).toBeGreaterThan(270); // slower than the fresh 4:30 median
    expect(runMean).toBeLessThan(270 * 1.3);
    // …while keeping the real shape: later runs stay slower than earlier ones.
    expect(runSegments[7].estimatedSeconds).toBeGreaterThan(runSegments[0].estimatedSeconds);
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
    // Training lighter than standard predicts slower at race load than training
    // heavier (both stay bounded to the field-anchored band).
    expect(lighterWallBalls.estimatedSeconds).toBeGreaterThan(heavierWallBalls.estimatedSeconds);
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

  it("projects an in-band partial interval to the full station via the power law", () => {
    // 500 m SkiErg in 2:00 → 1000 m via Riegel: 120s * 2^1.06 ≈ 250s
    // (slightly slower than the naive linear 240s, as pace fades over distance).
    const features = buildRacePredictionFeatures(
      [set("skierg", { time: 2, distance: 500, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.skierg.medianSeconds).toBeCloseTo(250, 0);
  });

  it("drops an out-of-band tiny interval and falls back to the benchmark", () => {
    // A 250 m SkiErg interval (0.25× the 1000 m station) is too short to trust,
    // so it's dropped and the station uses its division benchmark instead.
    const features = buildRacePredictionFeatures(
      [set("skierg", { time: 1, distance: 250, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.skierg.medianSeconds).toBeNull();
    const ski = features.baselineSegments.find((s) => s.exerciseName === "skierg");
    expect(ski?.basis).toBe("benchmark");
    expect(ski?.estimatedSeconds).toBe(
      getRaceReference("open", "male").stations.skierg.benchmarkSeconds,
    );
  });

  it("projects an in-band partial rep set to the full station via the power law", () => {
    // 50 wall balls in 2:30 → 100 reps via Riegel: 150s * 2^1.06 ≈ 313s.
    const features = buildRacePredictionFeatures(
      [set("wall_balls", { time: 2.5, reps: 50, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.wall_balls.medianSeconds).toBeCloseTo(150 * 2 ** 1.06, 1);
  });

  it("projects a load-grind station with a steeper exponent than endurance work", () => {
    // Sled push fatigues on load/mechanics faster than an erg, so it uses 1.10,
    // not Riegel's endurance 1.06. A 25 m effort (half the 50 m station) in 2:00
    // projects to 120s * 2^1.10 — slower than the 120s * 2^1.06 an endurance
    // station would yield from the same partial effort.
    const target = getRaceReference("open", "male").stations.sled_push.distanceMeters!;
    const features = buildRacePredictionFeatures(
      [set("sled_push", { time: 2, distance: target / 2, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.stationFeatures.sled_push.medianSeconds).toBeCloseTo(120 * 2 ** 1.1, 1);
    expect(120 * 2 ** 1.1).toBeGreaterThan(120 * 2 ** 1.06);
  });

  it("counts repeated sets in one session as a single independent sample", () => {
    // Three full-station SkiErg intervals (240/252/270s) in the SAME workout are
    // correlated, so they collapse to one sample at the session median (252s);
    // best stays the fastest single split (240s).
    const skierg = skiergSessionFeature([
      { workoutLogId: "w1", date: "2026-05-20" },
      { workoutLogId: "w1", date: "2026-05-20" },
      { workoutLogId: "w1", date: "2026-05-20" },
    ]);
    expect(skierg.sampleSize).toBe(1);
    expect(skierg.medianSeconds).toBeCloseTo(252, 0);
    expect(skierg.bestSeconds).toBeCloseTo(240, 0);
  });

  it("counts the same efforts across separate sessions as independent samples", () => {
    // Identical splits, one per workout → three independent samples.
    const skierg = skiergSessionFeature([
      { workoutLogId: "w1", date: "2026-05-18" },
      { workoutLogId: "w2", date: "2026-05-20" },
      { workoutLogId: "w3", date: "2026-05-22" },
    ]);
    expect(skierg.sampleSize).toBe(3);
    expect(skierg.medianSeconds).toBeCloseTo(252, 0);
  });

  it("converts feet-stored distance for miles users before projecting", () => {
    // A miles user's full 1 km SkiErg is stored as ~3281 ft. Converted to meters
    // it's a full-station effort (~unchanged), NOT a 3281 m effort that would be
    // dropped/understated. Logged 4:00 → stays ≈ 4:00.
    const fullStationFeet = 1000 * 3.28084;
    const features = buildRacePredictionFeatures(
      [set("skierg", { time: 4, distance: fullStationFeet, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg", distanceUnit: "miles" },
      NOW,
    );
    expect(features.stationFeatures.skierg.medianSeconds).toBeCloseTo(240, 0);
  });

  it("bounds an impossibly fast logged split to the field-anchored floor", () => {
    // A 0:48 SkiErg logged without a distance must not surface as a 1000 m split.
    const features = buildRacePredictionFeatures(
      [set("skierg", { time: 0.8, date: "2026-05-20" })],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    const ski = features.baselineSegments.find((s) => s.exerciseName === "skierg")!;
    expect(ski.basis).toBe("logged");
    // Bounded to MIN_PERSONAL_FRACTION × the cohort median (a realistic fast
    // split), which sits above the world-class floor — not at it.
    expect(ski.estimatedSeconds).toBe(Math.round(MIN_PERSONAL_FRACTION * ski.benchmarkSeconds));
    expect(ski.estimatedSeconds).toBeGreaterThan(ski.floorSeconds);
  });

  it("includes the cohort transition (roxzone) total in the deterministic finish", () => {
    const features = buildRacePredictionFeatures([], {
      division: "open",
      gender: "male",
      weightUnit: "kg",
    });
    const segmentSum = features.baselineSegments.reduce((t, s) => t + s.estimatedSeconds, 0);
    expect(features.transitionSeconds).toBeGreaterThan(0);
    expect(features.deterministicFinishSeconds).toBe(segmentSum + features.transitionSeconds);
  });

  it("uses the athlete's age-group cohort when it exists, else falls back to all ages", () => {
    const withAge = buildRacePredictionFeatures(
      [],
      { division: "open", gender: "male", weightUnit: "kg", ageGroup: "30-34" },
      NOW,
    );
    expect(withAge.resolvedAgeGroup).toBe("30-34");
    expect(withAge.ageGroupAssumed).toBe(false);

    const noAge = buildRacePredictionFeatures(
      [],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(noAge.resolvedAgeGroup).toBeNull();
    expect(noAge.ageGroupAssumed).toBe(true);
  });

  it("exposes the cohort benchmark on every baseline segment", () => {
    const features = buildRacePredictionFeatures(
      [],
      { division: "open", gender: "male", weightUnit: "kg" },
      NOW,
    );
    expect(features.baselineSegments).toHaveLength(16);
    expect(features.baselineSegments.every((s) => s.benchmarkSeconds > 0)).toBe(true);
    const wallBalls = features.baselineSegments.find((s) => s.exerciseName === "wall_balls")!;
    expect(wallBalls.benchmarkSeconds).toBe(
      getRaceReference("open", "male").stations.wall_balls.benchmarkSeconds,
    );
  });
});
