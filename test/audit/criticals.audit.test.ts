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
  ABSOLUTE_CALORIE_FLOOR,
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
import { makeWorkoutLog } from "../../server/services/trainingLoadService.testHelpers";
import { resolveStructureStepTimeTarget } from "../../server/services/workoutService/structure";
import { minutes, minutesToSeconds, unitless } from "../../shared/units";

const TODAY = "2026-06-30";

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** makeWorkoutLog re-anchored to this suite's pinned TODAY. */
function log(overrides: Partial<WorkoutLog>): WorkoutLog {
  return makeWorkoutLog({ date: TODAY, ...overrides });
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

describe("C1 — Foster monotony for perfectly uniform training (FIXED)", () => {
  /**
   * C1 — FIXED. `computeMonotonyStrain` now separates the two SD = 0 cases and
   * computes variance two-pass, so identical daily load is reported at
   * MONOTONY_CEILING and classified high_risk regardless of the magnitude of
   * the values. Previously RPE 5 (66 UTSS/day) cancelled to exactly 0 and
   * scored monotony null → zone "ok", while RPE 7 (94.8 UTSS/day) left a
   * ~1.3e-6 residue and scored 70,289,952.98 — the same pattern, two absurd
   * answers, chosen by a float bit pattern.
   */
  it("scores identical daily load as maximum monotony, at any magnitude", () => {
    const rpe5 = loadToday(identicalDailyTraining(5, 60, 40));
    const rpe7 = loadToday(identicalDailyTraining(7, 60, 40));

    // The two magnitudes that used to diverge now agree.
    expect(rpe5.utss).toBe(66);
    expect(rpe7.utss).toBe(94.8);
    expect(rpe5.monotony).toBe(rpe7.monotony);

    expect(monotonyZone(rpe5.monotony)).toBe("high_risk");
    expect(monotonyZone(rpe7.monotony)).toBe("high_risk");
  });

  /** Strain stays on a human scale instead of reaching 4.7e10. */
  it("keeps strain finite and legible for uniform load", () => {
    const today = loadToday(identicalDailyTraining(7, 60, 40));

    expect(today.strain).not.toBeNull();
    expect(today.strain!).toBeLessThan(10_000);
  });

  /**
   * The other half of the split: a week with no load at all is genuinely
   * undefined (0/0), and must read "unknown" rather than the healthy "ok" it
   * used to be classified as.
   */
  it("reports a week with no training as unknown, not ok", () => {
    const today = loadToday([log({ date: shiftDate(TODAY, -60), duration: 60, rpe: 7 })]);

    expect(today.utss).toBe(0);
    expect(today.monotony).toBeNull();
    expect(monotonyZone(null)).toBe("unknown");
  });

  /**
   * A varied week is scored normally — the control that the metric still works.
   *
   * This asserted "high_risk" until M26 corrected the SD convention, and the
   * change of answer is the point rather than a regression. Monotony is read
   * against an ABSOLUTE threshold taken from Foster, and dividing by n instead
   * of n - 1 ran every score 8.01% above what that threshold was calibrated
   * for. This exact week is what that looks like on a real athlete: it scored
   * 2.091 and was flagged for overtraining, and scores 1.936 under the
   * convention the 2.0 threshold actually came from. Same training, and it was
   * never over the line.
   */
  it("scores a varied week correctly (control)", () => {
    const varied = [10, 6, 12, 0, 9, 11, 7].map((minutes, i) =>
      log({ id: `log-${i}`, date: shiftDate(TODAY, -i), duration: minutes * 6, rpe: 7 }),
    );
    const today = loadToday(varied);

    expect(today.monotony).not.toBeNull();
    // Still measured and still discriminating — the control's actual job.
    expect(monotonyZone(today.monotony)).toBe("elevated");
    expect(today.monotony!).toBeGreaterThan(1.5);
    expect(today.monotony!).toBeLessThan(2);
  });
});

describe("C2 — MAF aerobic ceiling across the age-65 boundary (FIXED)", () => {
  const healthyImprovingAthlete = {
    injuryIllnessMedication: false,
    consistency: "high",
    trend: "improving",
  } as const;

  /**
   * C2 — FIXED. The `age >= 65` branch no longer sits above the consistency/trend
   * checks and no longer applies -5. The athlete keeps the category they earned,
   * and 65+ adds a clinician-check warning instead of a silent penalty.
   * Maffetone's 65+ exception is an upward allowance ("up to 10 beats may have to
   * be added"), and it is discretionary — so it is surfaced, not auto-applied.
   */
  it("no longer drops the ceiling 11 bpm between age 64 and 65", () => {
    const at64 = calculateMafHr({ ...healthyImprovingAthlete, age: 64 });
    const at65 = calculateMafHr({ ...healthyImprovingAthlete, age: 65 });

    expect(at64.ceiling).toBe(121);
    expect(at65.ceiling).toBe(120); // was 110
    expect(at64.ceiling - at65.ceiling).toBe(1);

    expect(at65.adjustment).toBe(5);
    expect(at65.reasonCodes).toContain("age_over_65_clinician_check");
  });

  /**
   * Was `it.fails` — the invariant C2 violated. Now a permanent guard: no single
   * year of age may cost more than the one beat `180 - age` accounts for.
   */
  it("one year of age never costs more than 1 bpm of ceiling", () => {
    for (let age = 17; age < 99; age++) {
      const younger = calculateMafHr({ ...healthyImprovingAthlete, age });
      const older = calculateMafHr({ ...healthyImprovingAthlete, age: age + 1 });
      expect(younger.ceiling - older.ceiling).toBeLessThanOrEqual(1);
    }
  });

  /** The conservative branches are untouched — this was never about softening them. */
  it("still applies the full -10 for injury, illness or medication", () => {
    const result = calculateMafHr({
      ...healthyImprovingAthlete,
      age: 70,
      injuryIllnessMedication: true,
    });
    expect(result.adjustment).toBe(-10);
  });
});

describe("C3 — Form/TSB and the history gate (FIXED)", () => {
  /**
   * C3 — FIXED in two places, because the gate alone was not enough.
   *  1. `day.tsb` is now assigned BELOW the `ratioFrom` gate, so Form is
   *     withheld for the same first 14 days as ACWR.
   *  2. `computeRaceReadiness` now takes acute load. The gate alone does not
   *     cover this athlete — their one workout is 20 days old, i.e. past the
   *     gate — so TSB is legitimately computed and still large and positive.
   *     Acute load is what separates a taper from having simply stopped.
   */
  it("no longer calls an athlete with one workout 20 days ago race-ready", () => {
    const today = loadToday([log({ date: shiftDate(TODAY, -20), duration: 60, rpe: 7 })]);

    // Past the 14-day gate, so ACWR and TSB are both computed...
    expect(today.acwr).toBe(0.01);
    expect(today.zone).toBe("undertraining");
    expect(today.tsb).toBeGreaterThan(15);

    // ...but acute load has collapsed, so there is no form to read.
    expect(today.acuteEwma!).toBeLessThan(5);
    const readiness = computeRaceReadiness(today.tsb, today.acuteEwma);
    expect(readiness.status).toBe("insufficient_data");
    expect(readiness.tsb).toBeNull();
  });

  /** The invariant: the two signals must never contradict each other. */
  it("never reports an undertrained athlete as peaked", () => {
    const today = loadToday([log({ date: shiftDate(TODAY, -20), duration: 60, rpe: 7 })]);

    expect(today.zone).toBe("undertraining");
    expect(computeRaceReadiness(today.tsb, today.acuteEwma).status).not.toBe("peaked");
  });

  /** Form is withheld entirely inside the 14-day window, as ACWR already was. */
  it("withholds Form until the ACWR baseline exists", () => {
    const today = loadToday([log({ date: shiftDate(TODAY, -3), duration: 60, rpe: 7 })]);

    expect(today.acwr).toBeNull();
    expect(today.zone).toBe("insufficient_data");
    expect(today.tsb).toBeNull();
  });

  /** A genuine taper — real recent load, positive Form — still reads as peaked. */
  it("still reports a real taper as peaked (control)", () => {
    const readiness = computeRaceReadiness(20, 45);
    expect(readiness.status).toBe("peaked");
    expect(readiness.tsb).toBe(20);
  });
});

describe("C4 — ageing past the top benchmark cohort (FIXED)", () => {
  /**
   * C4 — RETIRED 2026-08-22 (Phase 4+). `resolveRaceReference` now clamps to the
   * nearest band that actually HAS a cohort instead of falling through to the
   * all-ages roll-up, which is dominated by 25-39-year-olds and so was faster
   * than any masters cohort. Kept as a regression guard on the clamp.
   */
  it("[FIXED C4] keeps a 67-year-old on the oldest real cohort, not the all-ages roll-up", () => {
    const at62 = resolveRaceReference("open", "male", deriveAgeGroupFromAge(62));
    const at67 = resolveRaceReference("open", "male", deriveAgeGroupFromAge(67));

    expect(at62.resolvedAgeGroup).toBe("60-64");
    expect(at62.ageGroupAssumed).toBe(false);

    // 65-69 is a real band with no cohort behind it, so the athlete is clamped
    // to 60-64 and told the band was assumed — rather than being handed the
    // all-ages reference, which used to predict them 9:47 FASTER than at 62.
    expect(deriveAgeGroupFromAge(67)).toBe("65-69");
    expect(at67.resolvedAgeGroup).toBe("60-64");
    expect(at67.ageGroupAssumed).toBe(true);

    const older = totalReferenceSeconds(at67.reference);
    const younger = totalReferenceSeconds(at62.reference);
    expect(older).toBe(younger);
  });

  /**
   * CORRECTION to the Phase 0 intent test.
   *
   * It originally asserted "the reference never gets faster as the athlete gets
   * older" across 25-75. That invariant is FALSE OF THE WORLD, and the fix
   * exposed it: with C4's all-ages cliff removed, one 3-second inversion
   * survives at 25-29 (5082s) → 30-34 (5079s). That is not a defect. Hyrox
   * athletes genuinely peak around 30-34 — the generated cohorts run 16-24
   * 5089s, 25-29 5082s, 30-34 5079s, 35-39 5133s — so the reference legitimately
   * improves through the athlete's twenties before degrading.
   *
   * Forcing the code to satisfy the original invariant would have meant
   * distorting real benchmark data to fit a wrong assumption. The two
   * assertions below are what C4 was actually about.
   */
  it("[INTENT C4] never gets faster with age once past the 30-34 performance peak", () => {
    for (let age = 35; age <= 75; age++) {
      const younger = totalReferenceSeconds(
        resolveRaceReference("open", "male", deriveAgeGroupFromAge(age)).reference,
      );
      const older = totalReferenceSeconds(
        resolveRaceReference("open", "male", deriveAgeGroupFromAge(age + 5)).reference,
      );
      expect(older).toBeGreaterThanOrEqual(younger);
    }
  });

  it("[INTENT C4] never drops an athlete onto the all-ages roll-up", () => {
    // The cliff itself: a real band with no cohort behind it must clamp to a
    // neighbouring cohort, never to the all-ages reference. Every age from 16
    // up must resolve to a named band.
    for (let age = 16; age <= 99; age++) {
      const resolved = resolveRaceReference("open", "male", deriveAgeGroupFromAge(age));
      expect(resolved.resolvedAgeGroup).not.toBeNull();
    }
  });

  it("[INTENT C4] no five-year step swings the reference by anything like the old cliff", () => {
    // C4 moved a 67-year-old 9:47 (587s) FASTER. Genuine cohort-to-cohort
    // variation is single-digit seconds to a few minutes, and never improves by
    // more than the ~7s of the twenties peak.
    for (let age = 16; age <= 90; age++) {
      const younger = totalReferenceSeconds(
        resolveRaceReference("open", "male", deriveAgeGroupFromAge(age)).reference,
      );
      const older = totalReferenceSeconds(
        resolveRaceReference("open", "male", deriveAgeGroupFromAge(age + 5)).reference,
      );
      expect(younger - older).toBeLessThan(60);
    }
  });
});

describe("C5 — periodisation and the calorie safety floor (FIXED)", () => {
  /**
   * C5 — FIXED. `effectiveTargetWindowed` now bounds how far the carb delta may
   * go negative so the load-scaled target cannot fall below the safety floor,
   * and emits `effective_calorie_floor_applied` when that bound binds. The bound
   * is applied to carbs rather than to `calories` directly so the returned
   * calories and macros stay reconciled.
   */
  it("holds a 55 kg athlete's rest-day target at the floor, and says so", () => {
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

    // Previously 1158 kcal — below the floor — with an empty reasonCodes array.
    expect(restDay.calories).toBe(ABSOLUTE_CALORIE_FLOOR);
    expect(restDay.reasonCodes).toContain("effective_calorie_floor_applied");

    // Calories and macros still reconcile: carbs were the lever, not a bare bump.
    const fromMacros = restDay.proteinG! * 4 + restDay.carbG! * 4 + restDay.fatG! * 9;
    expect(fromMacros).toBeCloseTo(restDay.calories!, 0);
  });

  /** A day that never approaches the floor is untouched. */
  it("leaves a well-fed athlete's scaling alone (control)", () => {
    const baseline = calculateNutritionTarget({
      bodyweightKg: 80,
      heightCm: 182,
      ageYears: 30,
      sex: "male",
      activityLevel: "active",
      goalDirection: "maintain",
      goalRateKgPerWeek: 0,
    });
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

    expect(restDay.calories!).toBeGreaterThan(ABSOLUTE_CALORIE_FLOOR);
    expect(restDay.reasonCodes).not.toContain("effective_calorie_floor_applied");
  });
});

describe("C6 — the periodisation reference load (FIXED)", () => {
  /**
   * C6 — RETIRED 2026-08-22. `TargetsDialog` now passes the athlete's 28-day
   * chronic EWMA instead of a hardcoded 0, so the reference is the athlete's own
   * typical load. When there genuinely is no history the config reports
   * `referenceBasis: "assumed"` and the dialog says so, rather than presenting
   * the placeholder as personalisation.
   */
  it("[FIXED C6] uses the athlete's real load, and flags the placeholder when there is none", () => {
    const light = defaultPeriodizationConfig(300, 15);
    expect(light.referenceUtss).toBe(25); // floored at MIN_REFERENCE_UTSS
    expect(light.referenceBasis).toBe("measured");

    const heavy = defaultPeriodizationConfig(300, 120);
    expect(heavy.referenceUtss).toBe(120);
    expect(heavy.referenceBasis).toBe("measured");

    // No history: the placeholder still applies, but is no longer silent.
    for (const noLoad of [0, null]) {
      const assumed = defaultPeriodizationConfig(300, noLoad);
      expect(assumed.referenceUtss).toBe(50);
      expect(assumed.referenceBasis).toBe("assumed");
    }
  });

  /**
   * The consequence C6 produced, now measured against the athlete's own load:
   * a typical session no longer reads as a below-average day.
   */
  it("[FIXED C6] stops cutting carbs on a genuine training day", () => {
    const baseline = calculateNutritionTarget({
      bodyweightKg: 70,
      heightCm: 175,
      ageYears: 32,
      sex: "male",
      activityLevel: "moderate",
      goalDirection: "maintain",
      goalRateKgPerWeek: 0,
    });
    const base = {
      calories: baseline.calories,
      proteinG: baseline.proteinG,
      carbG: baseline.carbG,
      fatG: baseline.fatG,
    };
    // An athlete whose typical day really is ~30 UTSS.
    const config: PeriodizationConfig = {
      enabled: true,
      ...defaultPeriodizationConfig(baseline.carbG, 30),
    };

    const trainingDay = effectiveTarget(base, 30, config);

    // A day at the athlete's own typical load is neutral, not a deficit.
    expect(trainingDay.carbDeltaG).toBe(0);
    expect(trainingDay.carbG).toBe(baseline.carbG);

    // And a genuinely hard day is now a surplus.
    const hardDay = effectiveTarget(base, 60, config);
    expect(hardDay.carbDeltaG).toBeGreaterThan(0);
  });

  /**
   * The pre-fix behaviour, kept as the record of what the hardcoded 50 did.
   */
  it("[FIXED C6] shows what the assumed 50 used to do to a training day", () => {
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
   * RETIRED 2026-08-22 (Phase 1). `resolveStructureStepTimeTarget` now converts
   * the seconds-valued key on the way in, and `server/services/workoutService.test.ts`
   * has been inverted off the 60x passthrough it used to certify. Kept as a
   * regression guard: the two keys must not be coalesced again.
   */
  it("[FIXED C7] converts a seconds-valued step target into the minutes column", () => {
    expect(resolveStructureStepTimeTarget({ durationSeconds: 45 })).toBe(0.75);
    // targetTime is already minutes and must NOT be divided.
    expect(resolveStructureStepTimeTarget({ targetTime: 30, durationSeconds: 45 })).toBe(30);
  });

  /**
   * H1 — the same class of error, second instance. `mafTestService` assigns
   * `workout_logs.duration` (documented MINUTES) to `MafTestMetrics.durationSeconds`
   * (documented canonical seconds), so every MAF pace is 60x too fast.
   * RETIRED 2026-08-22 (Phase 1). `mafTestService` now converts the minutes
   * column to seconds at the assignment. Kept as a regression guard on the
   * conversion itself: a 10 km run logged as 60 minutes must read 2.78 m/s.
   */
  it("[FIXED H1] derives MAF pace from a duration converted to real seconds", () => {
    const loggedMinutes = 60;
    const asStored = metersPerSecond(10_000, unitless(minutesToSeconds(minutes(loggedMinutes))));

    expect(asStored).toBeCloseTo(2.778, 3);
    // The pre-fix value, for the record: passing the minutes across unconverted
    // read 166.67 m/s -- 60x too fast, and a 0:06/km pace on the MAF trend.
    expect(metersPerSecond(10_000, loggedMinutes)).toBeCloseTo(166.667, 3);
  });
});
