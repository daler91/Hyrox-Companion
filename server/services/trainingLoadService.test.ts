import type { TrainingLoadOverview, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import {
  calculateCardioStressScore,
  calculateStrengthStressScore,
  calculateTrainingLoad,
  classifyHrZone,
  DEFAULT_EXERCISE_LOAD_TAGS,
  estimateHrMax,
  estimateLthr,
  hrIntensityFactor,
  hrReserveRatio,
  hrTss,
  hrZoneBoundaries,
  monotonyZone,
  powerIntensityFactor,
  powerTss,
  resolveAcwrZone,
  type TrainingLoadSet,
} from "./trainingLoadService";

function log(overrides: Partial<WorkoutLog>): WorkoutLog {
  return {
    id: "log-1",
    userId: "user-1",
    date: "2026-05-22",
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
    ...overrides,
  };
}

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
    const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate: "2026-05-22" }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-1",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Hill repeats 8x60 seconds",
        exerciseDetails: [
          { exerciseName: "hill_repeats", category: "running", setNumber: 1, time: 40 },
        ],
      },
    ], "2026-05-22");

    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(
      "posterior_chain_velocity_lock",
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].rationaleCode).toBe("posterior_chain_velocity_lock");
    expect(suggestions[0].structuredSetRows?.[0]).toEqual(
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
    const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate: "2026-05-22" }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-2",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Long road run with downhill finish",
      },
    ], "2026-05-22");

    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(
      "anterior_chain_braking_guard",
    );
    expect(suggestions[0].rationaleCode).toBe("anterior_chain_braking_guard");
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
    const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate: "2026-05-22" }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-3",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Track speed intervals",
      },
    ], "2026-05-22");

    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(
      "elastic_tendon_speed_guard",
    );
    expect(suggestions[0].rationaleCode).toBe("elastic_tendon_speed_guard");
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
    const summary = calculateTrainingLoad([...baseline, spike], [], [], { currentDate }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-4",
        date: "2026-05-25",
        focus: "Strength",
        mainWorkout: "Heavy lower-body lift",
      },
    ], currentDate);

    expect(summary.zone).toBe("danger");
    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain("acwr_danger_lock");
    expect(suggestions[0].rationaleCode).toBe("acwr_danger_lock");
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
    const summary = calculateTrainingLoad(priorWork, [], [], { currentDate }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-5",
        date: "2026-05-23",
        focus: "Strength",
        mainWorkout: "Heavy squats and sled pushes",
      },
    ], currentDate);

    expect(summary.zone).toBe("undertraining");
    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain("acwr_onramp");
    expect(suggestions[0].rationaleCode).toBe("acwr_onramp");
  });

  it("converges EWMA acute and chronic to equal values for steady load (ACWR 1, TSB 0)", () => {
    const currentDate = "2026-05-22";
    const { dailyLoads, overview } = steadyHistory(currentDate, 21);
    const today = dailyLoads.find((d) => d.date === currentDate);

    expect(today?.acwr).toBe(1);
    expect(today?.acuteEwma).toBe(today?.chronicEwma);
    expect(today?.tsb).toBe(0);
    expect(overview.tsb).toBe(0);
    // Identical days ⇒ zero day-to-day variance ⇒ monotony undefined (N/A).
    expect(overview.monotony).toBeNull();
    expect(overview.monotonyZone).toBe("ok");
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
    // Defaults (rest 60 / max 190) apply when no athlete context is supplied.
    expect(hrReserveRatio(125, undefined)).toBeCloseTo(0.5, 2);
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
    // Default axis (rest 60 / max 190) without an athlete.
    expect(hrZoneBoundaries()[0].minHr).toBe(60);
    expect(hrZoneBoundaries()[4].maxHr).toBe(190);
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
    expect(monotonyZone(null)).toBe("ok");
    expect(monotonyZone(1.0)).toBe("ok");
    expect(monotonyZone(1.7)).toBe("elevated");
    expect(monotonyZone(2.0)).toBe("elevated"); // boundary: >2.0 is high risk
    expect(monotonyZone(2.5)).toBe("high_risk");
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
