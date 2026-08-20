/**
 * Characterisation tests for the seven C-tier findings in
 * docs/CALCULATION_AUDIT_2026-08-20.md.
 *
 * These assert what the code does TODAY, which in every case below is wrong.
 * See ./README.md for the convention and for how to retire a test once its
 * finding is fixed.
 */
import { calculateMafHr, metersPerSecond } from "@shared/maf";
import {
  calculateNutritionTarget,
  defaultPeriodizationConfig,
  effectiveTarget,
  type PeriodizationConfig,
} from "@shared/nutritionTargets";
import { deriveAgeGroupFromAge } from "@shared/raceConstants";
import { type RaceReference, resolveRaceReference } from "@shared/raceSpec";
import type { WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { computeRaceReadiness } from "../../server/services/racePrediction/racePredictionService";
import { calculateTrainingLoad, monotonyZone } from "../../server/services/trainingLoadService";
import { resolveStructureStepTimeTarget } from "../../server/services/workoutService/structure";

const TODAY = "2026-06-30";

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function log(overrides: Partial<WorkoutLog>): WorkoutLog {
  return {
    id: "log-1",
    userId: "user-1",
    date: TODAY,
    focus: "Run",
    mainWorkout: "Easy run",
    accessory: null,
    notes: null,
    prescribedMainWorkout: null,
    prescribedAccessory: null,
    prescribedNotes: null,
    plannedSetCount: null,
    actualSetCount: null,
    matchedSetCount: null,
    addedSetCount: null,
    removedSetCount: null,
    compliancePct: null,
    duration: null,
    rpe: null,
    planDayId: null,
    planId: null,
    source: "manual",
    stravaActivityId: null,
    garminActivityId: null,
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    startedAt: null,
    timeOfDayMin: null,
    ...overrides,
  };
}

/** An identical `minutes` session at `rpe`, logged every day for `days` days ending TODAY. */
function identicalDailyTraining(rpe: number, minutes: number, days: number): WorkoutLog[] {
  return Array.from({ length: days + 1 }, (_, i) =>
    log({ id: `log-${i}`, date: shiftDate(TODAY, -i), duration: minutes, rpe }),
  );
}

function loadToday(logs: WorkoutLog[]) {
  const { dailyLoads } = calculateTrainingLoad(logs, [], [], { currentDate: TODAY });
  const today = dailyLoads.at(-1);
  if (!today) throw new Error("expected at least one daily load row");
  return today;
}

/** Summed median total for a cohort: 8 run legs + 8 stations + roxzone, in seconds. */
function totalReferenceSeconds(reference: RaceReference): number {
  const runs = reference.runLegBenchmarkSeconds.reduce((sum, s) => sum + s, 0);
  const stations = Object.values(reference.stations).reduce(
    (sum, station) => sum + station.benchmarkSeconds,
    0,
  );
  return runs + stations + reference.transitionTotalSeconds;
}

describe("C1 — Foster monotony is unreportable for perfectly uniform training", () => {
  /**
   * C1(a) — the null-guard face.
   * `computeMonotonyStrain` returns null when SD is 0, conflating "no training"
   * with "perfectly identical daily load" (unbounded monotony, maximum risk).
   * CURRENT:  monotony null → monotonyZone "ok" → every warning surface silent
   * INTENDED: a capped high value classified "high_risk"
   * RETIRE:   replace with `expect(monotonyZone(today.monotony)).toBe("high_risk")`.
   */
  it("[BUG C1a] reports an identical 60-min RPE-5 session every day as monotony null / zone ok", () => {
    const today = loadToday(identicalDailyTraining(5, 60, 40));

    expect(today.utss).toBe(66);
    expect(today.monotony).toBeNull();
    expect(today.strain).toBeNull();
    // The null is then classified as healthy, not as unknown.
    expect(monotonyZone(today.monotony)).toBe("ok");
  });

  /**
   * C1(b) — the float-cancellation face, same expression.
   * `variance = sumSq/n - mean*mean` is the unstable one-pass form. For seven
   * IDENTICAL values it cancels to exactly 0 at most magnitudes (66 above) but
   * leaves a ~1.3e-6 residue at others, producing an absurd finite monotony.
   * 94.8 UTSS/day is a 60-minute session at RPE 7 — an ordinary day.
   * CURRENT:  monotony 70,289,952.98 / strain 46,644,412,797.5
   * INTENDED: the same capped high value as C1a — identical input must not
   *           produce two different answers based on a float bit pattern.
   * RETIRE:   together with C1a; a two-pass variance fixes both.
   */
  it("[BUG C1b] reports an identical 60-min RPE-7 session every day as monotony ~7e7", () => {
    const today = loadToday(identicalDailyTraining(7, 60, 40));

    expect(today.utss).toBe(94.8);
    expect(today.monotony).toBe(70289952.98);
    expect(today.strain).toBe(46644412797.5);
  });

  /**
   * The invariant C1 violates. Passes today because the assertion inside fails.
   * RETIRE: when this reports "expected to fail, but passed", drop `.fails`.
   */
  it.fails("[INTENT C1] identical daily load is maximum monotony, however it is scored", () => {
    const rpe5 = loadToday(identicalDailyTraining(5, 60, 40));
    const rpe7 = loadToday(identicalDailyTraining(7, 60, 40));

    expect(monotonyZone(rpe5.monotony)).toBe("high_risk");
    expect(monotonyZone(rpe7.monotony)).toBe("high_risk");
  });

  /** A varied week is scored correctly — the control that proves the metric works at all. */
  it("scores a varied week correctly (control, not a bug)", () => {
    const varied = [10, 6, 12, 0, 9, 11, 7].map((minutes, i) =>
      log({ id: `log-${i}`, date: shiftDate(TODAY, -i), duration: minutes * 6, rpe: 7 }),
    );
    const today = loadToday(varied);

    expect(today.monotony).not.toBeNull();
    expect(monotonyZone(today.monotony)).toBe("high_risk");
  });
});

describe("C2 — MAF aerobic ceiling falls 11 bpm on the 65th birthday", () => {
  const healthyImprovingAthlete = {
    injuryIllnessMedication: false,
    consistency: "high",
    trend: "improving",
  } as const;

  /**
   * C2 — `age >= 65` is evaluated above the consistency/trend branch and applies
   * -5, pre-empting the +5 the athlete has earned. Maffetone's published 65+
   * exception runs the other way: up to +10 for category (d) athletes.
   * CURRENT:  age 64 → 121 bpm, age 65 → 110 bpm
   * INTENDED: age 65 → >= 120 bpm (base 115 + 5, optionally up to +10 more)
   * RETIRE:   assert the ceiling never drops by more than 1 bpm per year of age.
   */
  it("[BUG C2] drops the ceiling 11 bpm between age 64 and 65", () => {
    const at64 = calculateMafHr({ ...healthyImprovingAthlete, age: 64 });
    const at65 = calculateMafHr({ ...healthyImprovingAthlete, age: 65 });

    expect(at64.ceiling).toBe(121);
    expect(at64.adjustment).toBe(5);

    expect(at65.ceiling).toBe(110);
    expect(at65.adjustment).toBe(-5);
    expect(at65.reasonCodes).toContain("age_over_65_conservative_default");

    expect(at64.ceiling - at65.ceiling).toBe(11);
  });

  /**
   * The invariant C2 violates: ageing one year may lower the ceiling by the one
   * beat that `180 - age` accounts for, never by more.
   * RETIRE: when this reports "expected to fail, but passed", drop `.fails`.
   */
  it.fails("[INTENT C2] one year of age never costs more than 1 bpm of ceiling", () => {
    for (let age = 17; age < 99; age++) {
      const younger = calculateMafHr({ ...healthyImprovingAthlete, age });
      const older = calculateMafHr({ ...healthyImprovingAthlete, age: age + 1 });
      expect(younger.ceiling - older.ceiling).toBeLessThanOrEqual(1);
    }
  });
});

describe("C3 — Form/TSB skips the history gate that ACWR respects", () => {
  /**
   * C3 — `day.tsb` is assigned before the `ratioFrom` gate, so it is non-null
   * from the athlete's first logged day. Chronic EWMA decays far slower than
   * acute, so any layoff produces a large positive TSB, which reads as "peaked".
   * CURRENT:  one workout 20 days ago → tsb +26.7 → readiness "peaked"
   * INTENDED: tsb null until the ACWR baseline exists → "insufficient_data"
   * RETIRE:   assert `today.tsb` is null and readiness is "insufficient_data".
   */
  it("[BUG C3] calls an athlete with one workout 20 days ago race-ready", () => {
    const today = loadToday([log({ date: shiftDate(TODAY, -20), duration: 60, rpe: 7 })]);

    // The athlete has trained once, three weeks ago. ACWR reads that correctly:
    expect(today.acwr).toBe(0.01);
    expect(today.zone).toBe("undertraining");

    // Form, from the same data, says the opposite — and confidently.
    expect(today.tsb).not.toBeNull();
    expect(today.tsb).toBeGreaterThan(15);

    const readiness = computeRaceReadiness(today.tsb);
    expect(readiness.status).toBe("peaked");
    expect(readiness.guidance).toContain("ideal for race day");
  });

  /**
   * The invariant C3 violates: two signals derived from the same history must
   * not contradict each other. An athlete the load model calls "undertraining"
   * cannot simultaneously be peaked for a race.
   * RETIRE: when this reports "expected to fail, but passed", drop `.fails`.
   */
  it.fails("[INTENT C3] an undertrained athlete is never reported as peaked", () => {
    const today = loadToday([log({ date: shiftDate(TODAY, -20), duration: 60, rpe: 7 })]);

    expect(today.zone).toBe("undertraining");
    expect(computeRaceReadiness(today.tsb).status).not.toBe("peaked");
  });
});

describe("C4 — ageing past the top benchmark cohort predicts a faster race", () => {
  /**
   * C4 — `deriveAgeGroupFromAge` produces bands up to 80-84, but the generated
   * dataset stops at 60-64 for open male. On a miss the code falls back to the
   * all-ages roll-up, which is dominated by 25-39-year-olds — so the reference
   * gets FASTER the moment an athlete ages out of the table.
   * CURRENT:  age 62 → 60-64 cohort; age 67 → all-ages, ~9-10 min faster
   * INTENDED: clamp to the nearest available band (the oldest), never all-ages
   * RETIRE:   assert `resolvedAgeGroup` is "60-64" for a 67-year-old.
   */
  it("[BUG C4] predicts a 67-year-old faster than a 62-year-old", () => {
    const at62 = resolveRaceReference("open", "male", deriveAgeGroupFromAge(62));
    const at67 = resolveRaceReference("open", "male", deriveAgeGroupFromAge(67));

    expect(at62.resolvedAgeGroup).toBe("60-64");
    expect(at62.ageGroupAssumed).toBe(false);

    // 65-69 exists as a band but not as a cohort, so the athlete lands on all-ages.
    expect(deriveAgeGroupFromAge(67)).toBe("65-69");
    expect(at67.resolvedAgeGroup).toBeNull();
    expect(at67.ageGroupAssumed).toBe(true);

    const older = totalReferenceSeconds(at67.reference);
    const younger = totalReferenceSeconds(at62.reference);
    expect(older).toBeLessThan(younger);
    expect(younger - older).toBeGreaterThan(8 * 60);
  });

  /**
   * The invariant C4 violates.
   * RETIRE: when this reports "expected to fail, but passed", drop `.fails`.
   */
  it.fails("[INTENT C4] the reference never gets faster as the athlete gets older", () => {
    for (let age = 25; age <= 75; age++) {
      const younger = totalReferenceSeconds(
        resolveRaceReference("open", "male", deriveAgeGroupFromAge(age)).reference,
      );
      const older = totalReferenceSeconds(
        resolveRaceReference("open", "male", deriveAgeGroupFromAge(age + 5)).reference,
      );
      expect(older).toBeGreaterThanOrEqual(younger);
    }
  });
});

describe("C5 — periodisation breaches the calorie safety floor", () => {
  /**
   * C5 — the 1200/1500 kcal floor is enforced in `calculateNutritionTarget` and
   * never re-checked in `effectiveTargetWindowed`, so load-scaling can carry the
   * effective target below it silently — no warning, empty reasonCodes.
   * CURRENT:  baseline 1418 kcal (floor untriggered) → rest day 1158 kcal
   * INTENDED: the effective target is floored too, with a reason code
   * RETIRE:   assert `restDay.calories >= 1200` and a floor reason code is present.
   */
  it("[BUG C5] carries a 55 kg athlete's rest-day target below the 1200 kcal floor", () => {
    const baseline = calculateNutritionTarget({
      bodyweightKg: 55,
      heightCm: 162,
      ageYears: 34,
      sex: "female",
      activityLevel: "light",
      goalDirection: "lose",
      goalRateKgPerWeek: 0.25,
    });

    // The baseline itself is above the floor — this is not an aggressive-deficit case.
    expect(baseline.calories).toBe(1418);
    expect(baseline.reasonCodes).not.toContain("calorie_floor_applied");

    const config: PeriodizationConfig = {
      enabled: true,
      ...defaultPeriodizationConfig(baseline.carbG, 0),
    };
    const restDay = effectiveTarget(
      {
        calories: baseline.calories,
        proteinG: baseline.proteinG,
        carbG: baseline.carbG,
        fatG: baseline.fatG,
      },
      0,
      config,
    );

    expect(restDay.calories).toBe(1158);
    expect(restDay.calories).toBeLessThan(1200);
    // Silently: nothing tells the athlete a safety bound was crossed.
    expect(restDay.reasonCodes).toEqual([]);
  });
});

describe("C6 — every athlete gets a hardcoded 50 UTSS reference load", () => {
  /**
   * C6 — the sole call site is `defaultPeriodizationConfig(carbG, 0)`; the second
   * argument is the athlete's recent average daily UTSS, hardcoded to zero. The
   * function's docstring claims the reference is derived from that average.
   * CURRENT:  referenceUtss is 50 for every athlete, whatever they actually train
   * INTENDED: the athlete's real recent average, floored at MIN_REFERENCE_UTSS
   * RETIRE:   thread the real value through TargetsDialog and assert it is used.
   */
  it("[BUG C6] ignores the athlete's real load and always resolves to 50", () => {
    // What the docstring promises, if the real average were passed:
    expect(defaultPeriodizationConfig(300, 15).referenceUtss).toBe(25);
    expect(defaultPeriodizationConfig(300, 120).referenceUtss).toBe(120);

    // What every athlete actually gets, because the call site passes 0:
    expect(defaultPeriodizationConfig(300, 0).referenceUtss).toBe(50);
  });

  /**
   * The consequence: a real training day scores well under the assumed 50, so
   * carbs are cut on days the athlete actually trained.
   */
  it("[BUG C6] cuts carbs on a genuine training day because 50 UTSS is assumed normal", () => {
    const baseline = calculateNutritionTarget({
      bodyweightKg: 70,
      heightCm: 175,
      ageYears: 32,
      sex: "male",
      activityLevel: "moderate",
      goalDirection: "maintain",
      goalRateKgPerWeek: 0,
    });
    const config: PeriodizationConfig = {
      enabled: true,
      ...defaultPeriodizationConfig(baseline.carbG, 0),
    };
    const base = {
      calories: baseline.calories,
      proteinG: baseline.proteinG,
      carbG: baseline.carbG,
      fatG: baseline.fatG,
    };

    // A typical logged session measures ~10-30 UTSS in this model.
    const trainingDay = effectiveTarget(base, 30, config);

    expect(trainingDay.carbDeltaG).toBeLessThan(0);
    expect(trainingDay.carbG).toBeLessThan(baseline.carbG);
    expect(trainingDay.calories).toBeLessThan(baseline.calories);
  });
});

describe("C7 / H1 — seconds written into columns the app reads as minutes", () => {
  /**
   * C7 — the structure editor's Time field is labelled "Sec" (aria-label
   * "duration in seconds") and its value reaches `exercise_sets.time` verbatim.
   * That column is minutes: `plannedSessionEstimate` reads it as wall-clock
   * minutes and `workoutStructureSummary` renders it as `${set.time}min`.
   * CURRENT:  a 45-second step is stored as 45, i.e. 45 minutes (60x)
   * INTENDED: convert to minutes on the way in, or make the column's unit explicit
   * RETIRE:   assert the resolved target is 0.75 (minutes) for a 45-second step.
   *
   * NOTE: server/services/workoutService.test.ts:313 asserts this same
   * passthrough as correct behaviour. That test must be INVERTED, not kept,
   * when C7 is fixed.
   */
  it("[BUG C7] passes a seconds-valued step target straight through to a minutes column", () => {
    expect(resolveStructureStepTimeTarget({ durationSeconds: 45 })).toBe(45);
    expect(resolveStructureStepTimeTarget({ targetTime: 30, durationSeconds: 45 })).toBe(30);
  });

  /**
   * H1 — the same class of error, second instance. `mafTestService` assigns
   * `workout_logs.duration` (documented MINUTES) to `MafTestMetrics.durationSeconds`
   * (documented canonical seconds), so every MAF pace is 60x too fast.
   * CURRENT:  a 10 km run logged as 60 (minutes) reads as 166.67 m/s
   * INTENDED: 2.78 m/s (10000 m / 3600 s)
   * RETIRE:   multiply by 60 at the assignment, then assert 2.78.
   */
  it("[BUG H1] derives MAF pace from minutes while treating the value as seconds", () => {
    const asStored = metersPerSecond(10_000, 60); // 60 == minutes, stored into a seconds field
    const truth = metersPerSecond(10_000, 60 * 60);

    expect(asStored).toBeCloseTo(166.667, 3);
    expect(truth).toBeCloseTo(2.778, 3);
    expect(asStored! / truth!).toBeCloseTo(60, 6);
  });
});
