import type { TrainingLoadOverview, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import {
  bodyweightRepLoadKg,
  calculateCardioStressScore,
  calculateStrengthStressScore,
  calculateTrainingLoad,
  classifyHrZone,
  DEFAULT_EXERCISE_LOAD_TAGS,
  estimateHrMax,
  estimateLthr,
  EWMA_WARMUP_DAYS,
  hrIntensityFactor,
  hrReserveRatio,
  hrTss,
  hrZoneBoundaries,
  monotonyZone,
  powerIntensityFactor,
  powerTss,
  resolveAcwrZone,
  type TrainingLoadSet,
  type UpcomingWorkoutForLoad,
} from "./trainingLoadService";
import { makeWorkoutLog as log } from "./trainingLoadService.testHelpers";

function set(overrides: Partial<TrainingLoadSet>): TrainingLoadSet {
  return {
    workoutLogId: "log-1",
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    ...overrides,
  };
}

function daysBefore(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().split("T")[0];
}

// `count` consecutive identical training days (duration 60, RPE 6) ending on
// `currentDate`, run through the load model — shared setup for the ACWR history
// tests below.
function steadyHistory(currentDate: string, count: number) {
  const workoutLogs = Array.from({ length: count }, (_, i) =>
    log({ id: `log-${i}`, date: daysBefore(currentDate, i), duration: 60, rpe: 6 }),
  );
  return calculateTrainingLoad(workoutLogs, [], [], { currentDate });
}

// Shared harness for the restriction/suggestion tests below: run the load
// model over the given history, then feed the resulting overview plus one
// upcoming plan day to the load governor.
function governorRun(
  workoutLogs: WorkoutLog[],
  sets: TrainingLoadSet[],
  planDay: UpcomingWorkoutForLoad,
  currentDate = "2026-05-22",
) {
  const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate }).overview;
  const suggestions = buildLoadGovernorSuggestions(summary, [planDay], currentDate);
  return { summary, suggestions };
}

function expectRestrictionSuggestion(
  { summary, suggestions }: ReturnType<typeof governorRun>,
  restrictionId: string,
) {
  expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(restrictionId);
  expect(suggestions[0].rationaleCode).toBe(restrictionId);
}

describe("trainingLoadService", () => {
  it("applies nonlinear RPE scaling and exercise modifiers to strength stress", () => {
    const deadliftTag = DEFAULT_EXERCISE_LOAD_TAGS.find((tag) => tag.exerciseName === "deadlift");
    expect(deadliftTag).toBeDefined();
    const baseSet = { reps: 5, weight: 200, plannedReps: null, plannedWeight: null, distance: null, plannedDistance: null };

    const rpe7 = calculateStrengthStressScore(baseSet, deadliftTag!, 7);
    const rpe10 = calculateStrengthStressScore(baseSet, deadliftTag!, 10);

    expect(rpe7).toBeGreaterThan(0);
    expect(rpe10).toBeGreaterThan(rpe7 * 1.5);
  });

  it("normalizes weight to kg so kg and lb athletes get equal strength stress", () => {
    const tag = DEFAULT_EXERCISE_LOAD_TAGS.find((t) => t.exerciseName === "deadlift")!;
    const kgSet = { reps: 5, weight: 100, plannedReps: null, plannedWeight: null, distance: null, plannedDistance: null };
    const lbSet = { ...kgSet, weight: 220.462 }; // 100 kg expressed in lbs

    const kgStress = calculateStrengthStressScore(kgSet, tag, 8, "kg");
    const lbStress = calculateStrengthStressScore(lbSet, tag, 8, "lbs");

    expect(kgStress).toBeGreaterThan(0);
    expect(lbStress).toBeCloseTo(kgStress, 1);
  });

  it("threads weightUnit through calculateTrainingLoad so UTSS is unit-normalized", () => {
    const currentDate = "2026-05-22";
    const mkLog = (id: string) =>
      log({ id, date: currentDate, focus: "Strength", mainWorkout: "Deadlifts", rpe: 8 });
    const mkSet = (logId: string, weight: number) =>
      set({ workoutLogId: logId, exerciseName: "deadlift", category: "strength", reps: 5, weight });

    const kg = calculateTrainingLoad([mkLog("k")], [mkSet("k", 100)], [], { currentDate, weightUnit: "kg" });
    const lb = calculateTrainingLoad([mkLog("l")], [mkSet("l", 220.462)], [], { currentDate, weightUnit: "lbs" });

    expect(kg.overview.currentUtss).toBeGreaterThan(0);
    expect(lb.overview.currentUtss).toBeCloseTo(kg.overview.currentUtss, 1);
  });

  it("separates easy aerobic CSS from high-intensity cardio CSS", () => {
    const easy = calculateCardioStressScore(log({ duration: 45, rpe: 4 }), []);
    const interval = calculateCardioStressScore(log({ duration: 45, rpe: 10, mainWorkout: "Track intervals" }), []);

    expect(easy).toBeCloseTo(41.4, 1);
    expect(interval).toBeGreaterThan(110);
  });

  it("resolves ACWR zones including insufficient data and danger", () => {
    expect(resolveAcwrZone(null, 0)).toBe("insufficient_data");
    expect(resolveAcwrZone(0.7, 50)).toBe("undertraining");
    expect(resolveAcwrZone(1.1, 50)).toBe("sweet_spot");
    expect(resolveAcwrZone(1.4, 50)).toBe("yellow");
    expect(resolveAcwrZone(1.6, 50)).toBe("danger");
  });

  it("withholds ACWR for a brand-new athlete instead of flagging danger", () => {
    const currentDate = "2026-05-22";
    // 7 straight training days and nothing before them — the rolling 28-day
    // average would read ACWR ≈ 4 and cry "danger" at a brand-new athlete.
    const { dailyLoads, overview } = steadyHistory(currentDate, 7);

    const today = dailyLoads.find((d) => d.date === currentDate);
    expect(today?.acwr).toBeNull();
    expect(today?.zone).toBe("insufficient_data");
    expect(overview.zone).toBe("insufficient_data");
    expect(overview.acwr).toBeNull();
  });

  it("computes ACWR once two weeks of logged history exist", () => {
    const currentDate = "2026-05-22";
    const { dailyLoads, overview } = steadyHistory(currentDate, 21);

    const today = dailyLoads.find((d) => d.date === currentDate);
    expect(today?.acwr).not.toBeNull();
    expect(today?.zone).not.toBe("insufficient_data");
    expect(overview.zone).toBe(today?.zone);
    // Days before the guard window (first log + 13) still report insufficient.
    const early = dailyLoads.find((d) => d.date === daysBefore(currentDate, 8));
    expect(early?.zone).toBe("insufficient_data");
  });

  it("does not inflate ACWR for steady training before 28 days of history exist", () => {
    const currentDate = "2026-05-22";
    // 18 consecutive identical days. The chronic window is still 28 calendar
    // days wide, but only 18 of them are real history. Dividing by a fixed 28
    // would deflate the chronic baseline and read ACWR ≈ 1.55 ("danger") for an
    // athlete who has trained perfectly steadily. Coverage-adjusting the
    // denominator keeps acute ≈ chronic, so the zone is the sweet spot.
    const { dailyLoads, overview } = steadyHistory(currentDate, 18);

    const today = dailyLoads.find((d) => d.date === currentDate);
    expect(today?.acwr).toBeCloseTo(1, 1);
    expect(today?.zone).toBe("sweet_spot");
    expect(overview.zone).toBe("sweet_spot");
  });

  it("flags posterior-chain overlap and downshifts next-day hill repeats", () => {
    const workoutLogs = [log({ id: "deadlift-day", focus: "Strength", mainWorkout: "Heavy deadlifts", rpe: 9 })];
    const sets = Array.from({ length: 4 }, (_, index) =>
      set({
        workoutLogId: "deadlift-day",
        exerciseName: "deadlift",
        category: "strength",
        setNumber: index + 1,
        reps: 5,
        weight: 200,
      }),
    );
    const run = governorRun(workoutLogs, sets, {
      id: "plan-day-1",
      date: "2026-05-23",
      focus: "Run",
      mainWorkout: "Hill repeats 8x60 seconds",
      exerciseDetails: [
        { exerciseName: "hill_repeats", category: "running", setNumber: 1, time: 40 },
      ],
    });

    expectRestrictionSuggestion(run, "posterior_chain_velocity_lock");
    expect(run.suggestions).toHaveLength(1);
    expect(run.suggestions[0].structuredSetRows?.[0]).toEqual(
      expect.objectContaining({ exerciseName: "recovery_run", planDayId: "plan-day-1" }),
    );
  });

  it("flags anterior-chain braking risk after heavy squats", () => {
    const workoutLogs = [log({ id: "squat-day", focus: "Strength", mainWorkout: "Heavy squats", rpe: 9 })];
    const sets = Array.from({ length: 5 }, (_, index) =>
      set({
        workoutLogId: "squat-day",
        exerciseName: "back_squat",
        setNumber: index + 1,
        reps: 5,
        weight: 185,
      }),
    );
    const run = governorRun(workoutLogs, sets, {
      id: "plan-day-2",
      date: "2026-05-23",
      focus: "Run",
      mainWorkout: "Long road run with downhill finish",
    });

    expectRestrictionSuggestion(run, "anterior_chain_braking_guard");
  });

  it("flags seven-day elastic tendon overload and speed work", () => {
    const workoutLogs = Array.from({ length: 4 }, (_, index) =>
      log({
        id: `plyo-${index}`,
        date: daysBefore("2026-05-22", index),
        focus: "Plyo",
        mainWorkout: "Jump rope",
        rpe: 8,
      }),
    );
    const sets = workoutLogs.flatMap((workout, workoutIndex) =>
      Array.from({ length: 12 }, (_, setIndex) =>
        set({
          workoutLogId: workout.id,
          exerciseName: "jump_rope",
          category: "conditioning",
          setNumber: setIndex + 1,
          reps: 10,
          weight: 0,
          id: `plyo-${workoutIndex}-${setIndex}`,
        }),
      ),
    );
    const run = governorRun(workoutLogs, sets, {
      id: "plan-day-3",
      date: "2026-05-23",
      focus: "Run",
      mainWorkout: "Track speed intervals",
    });

    expectRestrictionSuggestion(run, "elastic_tendon_speed_guard");
  });

  it("uses ACWR danger to lock high-intensity work for the next four days", () => {
    const currentDate = "2026-05-22";
    const baseline = Array.from({ length: 27 }, (_, index) =>
      log({
        id: `base-${index}`,
        date: daysBefore(currentDate, index + 1),
        duration: 10,
        rpe: 4,
        focus: "Run",
        mainWorkout: "Easy run",
      }),
    );
    const spike = log({
      id: "spike",
      date: currentDate,
      duration: 120,
      rpe: 10,
      focus: "Run",
      mainWorkout: "Hard intervals",
    });
    const run = governorRun([...baseline, spike], [], {
      id: "plan-day-4",
      date: "2026-05-25",
      focus: "Strength",
      mainWorkout: "Heavy lower-body lift",
    }, currentDate);

    expect(run.summary.zone).toBe("danger");
    expectRestrictionSuggestion(run, "acwr_danger_lock");
  });

  it("uses ACWR yellow to soften near-term high-intensity work", () => {
    const summary: TrainingLoadOverview = {
      currentUtss: 70,
      acuteAvg: 70,
      chronicAvg: 50,
      acwr: 1.4,
      zone: "yellow",
      flaggedVectors: [],
      activeRestrictions: [{
        id: "acwr_yellow_guard",
        label: "ACWR yellow guard",
        severity: "caution",
        expiresOn: "2026-05-24",
        rationale: "Acute load is above the preferred chronic baseline range.",
      }],
      downshiftRationale: "Acute load is above the preferred chronic baseline range.",
      trend: [],
    };

    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-yellow",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Threshold track intervals",
      },
    ], "2026-05-22");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual(expect.objectContaining({
      rationaleCode: "acwr_yellow_guard",
    }));
    expect(suggestions[0].suggestion.priority).toBe("medium");
  });

  it("creates an undertraining on-ramp instead of restoring peak load", () => {
    const currentDate = "2026-05-22";
    const priorWork = Array.from({ length: 18 }, (_, index) =>
      log({
        id: `prior-${index}`,
        date: daysBefore(currentDate, index + 8),
        duration: 60,
        rpe: 7,
        focus: "Run",
        mainWorkout: "Steady run",
      }),
    );
    const run = governorRun(priorWork, [], {
      id: "plan-day-5",
      date: "2026-05-23",
      focus: "Strength",
      mainWorkout: "Heavy squats and sled pushes",
    }, currentDate);

    expect(run.summary.zone).toBe("undertraining");
    expectRestrictionSuggestion(run, "acwr_onramp");
  });

  it("converges EWMA acute and chronic to equal values for steady load (ACWR 1, TSB 0)", () => {
    const currentDate = "2026-05-22";
    const { dailyLoads, overview } = steadyHistory(currentDate, 21);
    const today = dailyLoads.find((d) => d.date === currentDate);

    expect(today?.acwr).toBe(1);
    expect(today?.acuteEwma).toBe(today?.chronicEwma);
    expect(today?.tsb).toBe(0);
    expect(overview.tsb).toBe(0);
    // Identical days ⇒ zero day-to-day variance ⇒ monotony DIVERGES, and that is
    // the maximum-risk pattern Foster's metric exists to detect. It is reported
    // at MONOTONY_CEILING rather than as null; a null here used to be classified
    // "ok", which silenced every warning surface at once (audit C1).
    expect(overview.monotony).toBe(10);
    expect(overview.monotonyZone).toBe("high_risk");
  });

  it("reports negative TSB on an acute spike and positive TSB after a rest gap", () => {
    const currentDate = "2026-05-22";
    // 27 low days then a big spike today — acute EWMA jumps above chronic.
    const baseline = Array.from({ length: 27 }, (_, i) =>
      log({ id: `b-${i}`, date: daysBefore(currentDate, i + 1), duration: 10, rpe: 4 }),
    );
    const spike = log({ id: "spike", date: currentDate, duration: 120, rpe: 10, mainWorkout: "Hard intervals" });
    const spiked = calculateTrainingLoad([...baseline, spike], [], [], { currentDate }).overview;
    expect(spiked.zone).toBe("danger");
    expect(spiked.tsb).toBeLessThan(0);

    // Steady block ending 8 days ago, then a rest gap — acute decays below chronic.
    const priorWork = Array.from({ length: 18 }, (_, i) =>
      log({ id: `p-${i}`, date: daysBefore(currentDate, i + 8), duration: 60, rpe: 7 }),
    );
    const rested = calculateTrainingLoad(priorWork, [], [], { currentDate }).overview;
    expect(rested.zone).toBe("undertraining");
    expect(rested.tsb).toBeGreaterThan(0);
  });

  it("estimates max HR via Tanaka with a flat fallback", () => {
    expect(estimateHrMax(30)).toBe(187);
    expect(estimateHrMax(null)).toBe(190);
    expect(estimateHrMax(0)).toBe(190);
  });

  it("computes a clamped Karvonen HR reserve ratio with null guards", () => {
    expect(hrReserveRatio(165, { age: 30 })).toBeCloseTo(0.827, 2);
    expect(hrReserveRatio(0, { age: 30 })).toBeNull();
    expect(hrReserveRatio(50, { age: 30, restingHr: 60 })).toBeNull(); // below resting
    expect(hrReserveRatio(250, { age: 30, maxHr: 180 })).toBe(1); // clamped to 1
  });

  it("withholds the HR signal entirely when there is no age and no measured max", () => {
    // INVERTED (audit H3). This asserted that the rest-60 / max-190 defaults
    // applied with no athlete context. 190 is the Tanaka prediction for a
    // 26-year-old, so a 52-year-old (true max 172) had a threshold run scored
    // at 69.2% of reserve instead of 82.3% and classified as easy aerobic Z2.
    // `users.age` is only written by the OPTIONAL nutrition onboarding step, so
    // skipping a nutrition screen corrupted every HR-derived number.
    expect(hrReserveRatio(125, undefined)).toBeNull();
    expect(hrReserveRatio(125, {})).toBeNull();
    expect(hrReserveRatio(125, { restingHr: 55 })).toBeNull();

    // A real basis — either measured max or an age — still works.
    expect(hrReserveRatio(125, { age: 30 })).toBeCloseTo(0.512, 2); // Tanaka max 187
    expect(hrReserveRatio(125, { maxHr: 190 })).toBeCloseTo(0.5, 2);
  });

  it("maps HR reserve and power %FTP into the 0.6–2.6 intensity band", () => {
    expect(hrIntensityFactor(0)).toBe(0.6);
    expect(hrIntensityFactor(0.5)).toBe(1.1);
    expect(hrIntensityFactor(1)).toBe(2.6);
    for (let hrr = 0; hrr <= 1.0001; hrr += 0.1) {
      const factor = hrIntensityFactor(hrr);
      expect(factor).toBeGreaterThanOrEqual(0.6);
      expect(factor).toBeLessThanOrEqual(2.6);
    }
    expect(powerIntensityFactor(125, 250)).toBe(1.1);
    expect(powerIntensityFactor(250, 250)).toBe(2.6);
    expect(powerIntensityFactor(300, 250)).toBe(2.6); // above FTP clamps to ceiling
    expect(powerIntensityFactor(200, null)).toBeNull();
    expect(powerIntensityFactor(null, 250)).toBeNull();
  });

  it("prefers objective HR over logged RPE for cardio intensity", () => {
    const rpeOnly = calculateCardioStressScore(log({ duration: 45, rpe: 4 }), []);
    const withHr = calculateCardioStressScore(
      log({ duration: 45, rpe: 4, avgHeartrate: 165 }),
      [],
      undefined,
      { age: 30 },
    );
    expect(rpeOnly).toBeCloseTo(41.4, 1);
    // HR at ~83% reserve scores far higher than the RPE-4 keyword path.
    expect(withHr).toBeGreaterThan(80);
    expect(withHr).not.toBeCloseTo(rpeOnly, 0);
  });

  it("computes display-only hrTSS/TSS in parallel without feeding UTSS", () => {
    const currentDate = "2026-05-22";
    const hrLog = log({ id: "hr", date: currentDate, duration: 60, avgHeartrate: 150 });
    const { dailyLoads, overview } = calculateTrainingLoad([hrLog], [], [], {
      currentDate,
      athlete: { age: 30, gender: "male" },
    });
    const today = dailyLoads.find((d) => d.date === currentDate);
    expect(today?.hrTss).toBeGreaterThan(0);
    // UTSS is strength + cardio only; hrTSS rides alongside, not inside it.
    expect(today?.utss).toBe(today?.cardioStressScore);
    expect(today?.utss).not.toBe(today?.hrTss);
    expect(overview.hrTss).toBe(today?.hrTss ?? null);

    const powerLog = log({ id: "pw", date: currentDate, duration: 60, avgWatts: 200 });
    const power = calculateTrainingLoad([powerLog], [], [], {
      currentDate,
      athlete: { ftp: 250 },
    });
    const powerDay = power.dailyLoads.find((d) => d.date === currentDate);
    expect(powerDay?.tss).toBeCloseTo(64, 0); // (60/60)·(200/250)²·100
  });

  it("estimates LTHR at ~88% of max HR, floored above resting", () => {
    expect(estimateLthr({ maxHr: 190, restingHr: 50 })).toBe(167); // 0.88 × 190 = 167.2
    expect(estimateLthr({ age: 30 })).toBe(165); // Tanaka(30)=187 → 0.88 × 187 = 164.6
    expect(estimateLthr({})).toBe(167); // default max 190
    expect(estimateLthr({ maxHr: 100, restingHr: 95 })).toBe(96); // floored to rest + 1
  });

  it("classifies a session's average HR into Karvonen %HRR zones", () => {
    const a = { restingHr: 60, maxHr: 190 }; // reserve 130; floors at 60/70/80/90%
    expect(classifyHrZone(60 + 0.5 * 130, a)).toBe("z1");
    expect(classifyHrZone(60 + 0.65 * 130, a)).toBe("z2");
    expect(classifyHrZone(60 + 0.75 * 130, a)).toBe("z3");
    expect(classifyHrZone(60 + 0.85 * 130, a)).toBe("z4");
    expect(classifyHrZone(190, a)).toBe("z5");
    expect(classifyHrZone(null, a)).toBeNull();
    expect(classifyHrZone(50, a)).toBeNull(); // below resting
  });

  it("derives HR-zone bpm boundaries spanning resting→max HR", () => {
    const zones = hrZoneBoundaries({ restingHr: 60, maxHr: 190 });
    expect(zones).toHaveLength(5);
    expect(zones[0]).toMatchObject({ zone: "z1", minHr: 60 });
    expect(zones[4]).toMatchObject({ zone: "z5", maxHr: 190 });
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].minHr).toBe(zones[i - 1].maxHr); // contiguous, monotonic
    }
    // INVERTED (audit H3): no measured max and no age means no honest zone
    // table, so none is produced rather than one built on a 26-year-old's
    // predicted max.
    expect(hrZoneBoundaries()).toEqual([]);
    expect(hrZoneBoundaries({ restingHr: 60 })).toEqual([]);
    // An age is enough to build a real axis.
    expect(hrZoneBoundaries({ age: 52 })[4].maxHr).toBe(172);
  });

  it("computes hrTSS anchored on estimated LTHR with null guards", () => {
    const a = { maxHr: 190, restingHr: 50 }; // LTHR = 167
    expect(hrTss(60, 167, a)).toBeCloseTo(100, 0); // avgHr == LTHR → IF 1.0
    expect(hrTss(30, 167, a)).toBeCloseTo(50, 0); // half the duration
    expect(hrTss(60, 200, a)).toBeCloseTo(100, 0); // above LTHR clamps IF at 1.0
    expect(hrTss(60, null, a)).toBeNull();
    expect(hrTss(0, 167, a)).toBeNull();
    expect(hrTss(60, 50, a)).toBeNull(); // at/below resting
  });

  it("computes simplified power TSS with null guards", () => {
    expect(powerTss(60, 250, 250)).toBe(100);
    expect(powerTss(30, 250, 250)).toBe(50);
    expect(powerTss(60, null, 250)).toBeNull();
    expect(powerTss(60, 250, null)).toBeNull();
  });

  it("classifies Foster monotony zones at the documented thresholds", () => {
    // null = the week carried no load, so monotony is 0/0. That is "unknown",
    // never "ok" — an absent measurement must not be styled or reasoned about
    // as a healthy one (audit C1).
    expect(monotonyZone(null)).toBe("unknown");
    expect(monotonyZone(1.0)).toBe("ok");
    expect(monotonyZone(1.7)).toBe("elevated");
    expect(monotonyZone(2.0)).toBe("elevated"); // boundary: >2.0 is high risk
    expect(monotonyZone(2.5)).toBe("high_risk");
  });

  it("withholds monotony until the athlete has a full 7-day window of history", () => {
    // The trailing window reads absent days as rest, so before day 7 a monotony
    // would be computed almost entirely from days that predate the athlete.
    const currentDate = "2026-05-22";
    const { dailyLoads } = calculateTrainingLoad([log({ date: "2026-05-19", duration: 60, rpe: 7 })], [], [], {
      currentDate,
    });
    const today = dailyLoads.find((d) => d.date === currentDate);

    expect(today?.monotony).toBeNull();
    expect(today?.strain).toBeNull();
  });

  it("returns no HR zone table when resting HR is above max HR", () => {
    // Mirrors the guard hrReserveRatio already applies; without it the reserve
    // goes negative and an inverted zone table renders as fact.
    expect(hrZoneBoundaries({ restingHr: 190, maxHr: 150 })).toEqual([]);
    expect(hrZoneBoundaries({ restingHr: 50, maxHr: 190 })).toHaveLength(5);
  });

  it("produces finite monotony/strain for a varied week", () => {
    const currentDate = "2026-05-22";
    const workoutLogs = Array.from({ length: 7 }, (_, i) =>
      log({ id: `v-${i}`, date: daysBefore(currentDate, i), duration: i % 2 === 0 ? 60 : 40, rpe: 6 }),
    );
    const { overview } = calculateTrainingLoad(workoutLogs, [], [], { currentDate });
    expect(overview.monotony).not.toBeNull();
    expect(overview.monotony).toBeGreaterThan(0);
    expect(overview.strain).not.toBeNull();
    expect(overview.strain).toBeGreaterThan(0);
  });

  it("threads power TSS and EWMA fitness/fatigue into the overview trend", () => {
    const currentDate = "2026-05-22";
    const logs = Array.from({ length: 5 }, (_, i) =>
      log({ id: `t-${i}`, date: daysBefore(currentDate, i), duration: 60, avgHeartrate: 150, avgWatts: 200, rpe: 6 }),
    );
    const { overview } = calculateTrainingLoad(logs, [], [], {
      currentDate,
      athlete: { age: 30, gender: "male", ftp: 250 },
    });
    const todayPoint = overview.trend.find((p) => p.date === currentDate);
    expect(todayPoint?.hrTss).toBeGreaterThan(0);
    expect(todayPoint?.tss).toBeGreaterThan(0);
    expect(todayPoint?.hrZone).not.toBeNull();
    expect(todayPoint?.acuteEwma).not.toBeNull();
    expect(todayPoint?.chronicEwma).not.toBeNull();
    // The trend's current-day TSS mirrors the overview's current-day TSS.
    expect(todayPoint?.tss).toBe(overview.tss);
    // Overview also carries the zone legend + estimated-load indicators.
    expect(overview.hrZones).toHaveLength(5);
    expect(overview.estimatedLthr).toBeGreaterThan(0);
    expect(overview.powerTssEstimated).toBe(true);
  });
});

describe("EWMA warmup — a short fetch window cannot reseed the baseline (audit H21)", () => {
  const CURRENT = "2026-05-22";

  // Eight heavy weeks then a taper week. The 28-day chronic baseline should
  // still be HIGH — that is what a taper is — while the last 7 days are light.
  const history = (() => {
    const logs: WorkoutLog[] = [];
    for (let i = 120; i >= 0; i--) {
      if (i % 7 === 3) continue; // one rest day a week
      const tapering = i <= 6;
      logs.push(
        log({
          id: `l-${i}`,
          date: daysBefore(CURRENT, i),
          duration: tapering ? 30 : 100,
          rpe: tapering ? 4 : 8,
        }),
      );
    }
    return logs;
  })();

  const today = (windowDays: number, declareWindow: boolean) => {
    const from = daysBefore(CURRENT, windowDays - 1);
    return calculateTrainingLoad(
      history.filter((l) => l.date >= from),
      [],
      [],
      { currentDate: CURRENT, ...(declareWindow ? { historyFrom: from } : {}) },
    ).dailyLoads.find((d) => d.date === CURRENT);
  };

  it("reports the same baseline once the window covers the warmup", () => {
    const full = today(120, true);
    const warm = today(EWMA_WARMUP_DAYS, true);

    expect(full?.chronicEwma).toBeGreaterThan(100);
    // Within a few percent of the 120-day truth — the seed has washed out.
    expect(warm?.chronicEwma).toBeCloseTo(full?.chronicEwma ?? 0, -1);
  });

  it("withholds the EWMAs when the declared window is too short to support them", () => {
    // The nutrition recovery path fetched 7 days and read a "28-day chronic
    // baseline" off the result: 26.1 against a true 107.2 for this athlete, a 4x
    // understatement of the load their fuelling is scaled from. Withheld is the
    // honest answer for a window that cannot support the number.
    const short = today(7, true);

    expect(short?.acuteEwma).toBeNull();
    expect(short?.chronicEwma).toBeNull();
    expect(short?.tsb).toBeNull();
    expect(short?.acwr).toBeNull();
    // UTSS is per-day and needs no history, so it still reports.
    expect(short?.utss).toBeGreaterThan(0);
  });

  it("leaves callers that do not declare a window exactly as they were", () => {
    const undeclared = today(7, false);

    expect(undeclared?.acuteEwma).not.toBeNull();
    expect(undeclared?.chronicEwma).not.toBeNull();
  });

  it("still reports for a genuinely new athlete inside a wide window", () => {
    // Their first log really is recent, and there is empty range before it — so
    // the seed is their real starting point, not an artefact of the fetch.
    const newAthlete = Array.from({ length: 20 }, (_, i) =>
      log({ id: `n-${i}`, date: daysBefore(CURRENT, i), duration: 60, rpe: 6 }),
    );
    const from = daysBefore(CURRENT, EWMA_WARMUP_DAYS - 1);
    const d = calculateTrainingLoad(newAthlete, [], [], {
      currentDate: CURRENT,
      historyFrom: from,
    }).dailyLoads.find((x) => x.date === CURRENT);

    expect(d?.chronicEwma).not.toBeNull();
    expect(d?.acwr).not.toBeNull();
  });
});

describe("injury vectors for workouts with no sets (audit H19)", () => {
  const DATE = "2026-05-22";
  const dayFor = (overrides: Partial<WorkoutLog>, sets: TrainingLoadSet[] = []) =>
    calculateTrainingLoad([log({ id: "log-1", date: DATE, duration: 60, rpe: 7, ...overrides })], sets, DEFAULT_EXERCISE_LOAD_TAGS, {
      currentDate: DATE,
      weightUnit: "kg",
    }).dailyLoads.find((d) => d.date === DATE);

  it("puts an imported run on the same vectors as the same run logged with sets", () => {
    // Every vector used to stay exactly 0 for a Strava/Garmin import or a
    // free-text log, so all four vector restrictions were inert for them — an
    // athlete whose running is all imported could never trip the Achilles guard.
    const imported = dayFor({ focus: "Easy Run", mainWorkout: "" });
    const logged = dayFor({ focus: "Run", mainWorkout: "8k easy" }, [
      set({ workoutLogId: "log-1", exerciseName: "easy_run", category: "running", distance: 8000, time: 45 }),
    ]);

    expect(imported?.vectorLoads.elastic_tendon).toBeGreaterThan(0);
    expect(imported?.vectorLoads.posterior_chain).toBeGreaterThan(0);
    expect(imported?.vectorLoads).toEqual(logged?.vectorLoads);
  });

  it("does not give a bike ride the impact profile of a run", () => {
    // "bike" is endurance text, so the session is duration-loaded — but the
    // running profile's elastic-tendon weighting is for repeated foot-strike.
    const ride = dayFor({ focus: "Ride", mainWorkout: "Zwift bike session" });

    expect(ride?.utss).toBeGreaterThan(0);
    expect(ride?.vectorLoads.elastic_tendon).toBe(0);
    expect(ride?.vectorLoads.posterior_chain).toBe(0);
  });

  it("stays near zero for a workout whose text names nothing recognisable", () => {
    const vague = dayFor({ focus: "Strength", mainWorkout: "Gym session, no detail" });

    expect(vague?.utss).toBeGreaterThan(0);
    expect(vague?.vectorLoads.posterior_chain).toBe(0);
    expect(vague?.vectorLoads.elastic_tendon).toBe(0);
  });

  it("leaves a session that DOES have sets exactly as it was", () => {
    // The strength path already put this session's tonnage on the vectors;
    // adding workout-level load on top would double-count it.
    const sets = Array.from({ length: 10 }, (_, i) =>
      set({ workoutLogId: "log-1", exerciseName: "back_squat", category: "strength", setNumber: i + 1, reps: 5, weight: 100 }),
    );
    const withSets = dayFor({ focus: "Strength", mainWorkout: "Back squat, bench" }, sets);

    expect(withSets?.utss).toBeCloseTo(99.1, 1);
    expect(withSets?.vectorLoads).toEqual({
      posterior_chain: 34.7,
      anterior_chain: 99.1,
      unilateral_stability: 19.8,
      elastic_tendon: 9.9,
    });
  });
});

describe("bodyweightRepLoadKg — unweighted reps scale with the athlete (audit M2)", () => {
  it("leaves the reference athlete exactly where they were", () => {
    // Every governor threshold, ACWR baseline and periodisation reference in
    // this app is calibrated against the existing UTSS scale, so the 75 kg
    // athlete must be unchanged by this fix.
    expect(bodyweightRepLoadKg(75)).toBe(20);
  });

  it("charges a heavier athlete more for the same burpee", () => {
    // Every unweighted rep used to be worth exactly 20 kg, so a 100 kg athlete
    // and a 55 kg athlete scored identical load for identical work.
    expect(bodyweightRepLoadKg(100)).toBeGreaterThan(bodyweightRepLoadKg(55));
    expect(bodyweightRepLoadKg(100)).toBeCloseTo(26.67, 1);
    expect(bodyweightRepLoadKg(55)).toBeCloseTo(14.67, 1);
  });

  it("falls back to the flat figure when bodyweight is unknown", () => {
    for (const missing of [null, undefined, 0, Number.NaN]) {
      expect(bodyweightRepLoadKg(missing)).toBe(20);
    }
  });

  it("bounds an implausible profile value so it cannot dominate the model", () => {
    expect(bodyweightRepLoadKg(5)).toBe(10); // 0.5x floor
    expect(bodyweightRepLoadKg(400)).toBe(40); // 2x ceiling
  });
});

describe("the standard-deviation convention monotony is measured with (audit M26)", () => {
  /**
   * A week whose day-to-day load varies, chosen so it lands in the band the
   * convention error created. Monotony is mean ÷ SD, so the ratio is what
   * matters and any linear scaling of these durations gives the same answer.
   */
  const VARIED_WEEK_MINUTES = [10, 6, 12, 0, 9, 11, 7];

  const TODAY = "2026-05-22";

  function monotonyForWeek(minutesPerDay: number[]): number {
    const logs = minutesPerDay.map((m, i) =>
      log({ id: `m-${i}`, date: daysBefore(TODAY, i), duration: m * 6, rpe: 7 }),
    );
    const { dailyLoads } = calculateTrainingLoad(logs, [], [], { currentDate: TODAY });
    const today = dailyLoads.at(-1);
    if (today?.monotony == null) throw new Error("expected a monotony for a week with load");
    return today.monotony;
  }

  it("uses the sample SD, so scores sit below what dividing by n gave", () => {
    // Population SD (÷n) scored this week 2.091 and flagged it high_risk.
    // Sample SD (÷n-1) scores 1.936 — the same training, under the convention
    // Foster's 2.0 threshold was actually established with.
    const monotony = monotonyForWeek(VARIED_WEEK_MINUTES);

    expect(monotony).toBeCloseTo(1.94, 1);
    expect(monotonyZone(monotony)).toBe("elevated");
  });

  it("puts the whole scale 8.01% below where dividing by n put it", () => {
    // sqrt(7/6) = 1.080123. Every score was that much high against an ABSOLUTE
    // threshold, which is what made the convention matter rather than being
    // cosmetic: it is 7.42% off in the other direction once corrected.
    const monotony = monotonyForWeek(VARIED_WEEK_MINUTES);
    const asPopulationSd = monotony * Math.sqrt(7 / 6);

    expect(asPopulationSd).toBeCloseTo(2.09, 1);
    // The old convention put this athlete over the line; the correct one does not.
    expect(monotonyZone(asPopulationSd)).toBe("high_risk");
    expect(monotonyZone(monotony)).toBe("elevated");
  });

  it("still reports the ceiling for a perfectly flat week", () => {
    // The n - 1 denominator changes the magnitude of a real SD, not the SD = 0
    // branch, so C1's uniform-load behaviour is untouched.
    expect(monotonyForWeek([60, 60, 60, 60, 60, 60, 60])).toBe(10);
  });
});

describe("calculateStrengthStressScore distance tonnage (C4)", () => {
  const tag = DEFAULT_EXERCISE_LOAD_TAGS.find((t) => t.exerciseName === "farmers carry")
    ?? DEFAULT_EXERCISE_LOAD_TAGS.find((t) => t.exerciseName === "deadlift")!;
  const base = { reps: null, weight: null, plannedReps: null, plannedWeight: null, plannedDistance: null };

  it("scores a stamped feet row the same as the equivalent stamped metre row", () => {
    const metres = calculateStrengthStressScore({ ...base, distance: 100, distanceUnit: "m" }, tag, 7);
    const feet = calculateStrengthStressScore({ ...base, distance: 328.084, distanceUnit: "ft" }, tag, 7);
    expect(metres).toBeGreaterThan(0);
    expect(feet).toBeCloseTo(metres, 1);
  });

  it("reads a legacy (unstamped) row in the athlete's current distance preference", () => {
    const kmAthlete = calculateStrengthStressScore({ ...base, distance: 100 }, tag, 7, "kg", null, "km");
    const milesAthlete = calculateStrengthStressScore({ ...base, distance: 328.084 }, tag, 7, "kg", null, "miles");
    expect(milesAthlete).toBeCloseTo(kmAthlete, 1);
  });

  it("treats an unstamped row as metres when no preference is supplied", () => {
    const bare = calculateStrengthStressScore({ ...base, distance: 100 }, tag, 7);
    const metres = calculateStrengthStressScore({ ...base, distance: 100, distanceUnit: "m" }, tag, 7);
    expect(bare).toBe(metres);
  });
});
