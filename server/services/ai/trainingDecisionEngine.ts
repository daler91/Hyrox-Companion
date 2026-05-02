export type TrainingPhase = "reset_repair" | "aerobic_base" | "bridge" | "performance";

export type WorkoutType =
  | "rest"
  | "mobility"
  | "easy_aerobic"
  | "skill_technique"
  | "strength"
  | "threshold"
  | "race_pace"
  | "hyrox_simulation";

export interface TrainingDecisionInput {
  profile: {
    experienceLevel?: "beginner" | "intermediate" | "advanced";
    primaryGoal?: "finish" | "improve" | "podium";
  };
  latestWorkouts: {
    completedLast7d: number;
    avgRpeLast3?: number;
  };
  testTrend: {
    direction: "improving" | "flat" | "declining" | "insufficient_data";
  };
  raceContext: {
    hasRace: boolean;
    daysToRace?: number | null;
  };
  recoveryMarkers: {
    sleepQuality?: "good" | "ok" | "poor";
    soreness?: "low" | "medium" | "high";
    restingHrDelta?: number;
    illnessFlag?: boolean;
  };
}

export interface TrainingDecision {
  phase: TrainingPhase;
  allowedWorkoutTypes: WorkoutType[];
  intensityPermitted: boolean;
  rationaleCodes: string[];
}

const BASE_ALLOWED: Record<TrainingPhase, WorkoutType[]> = {
  reset_repair: ["rest", "mobility", "easy_aerobic", "skill_technique"],
  aerobic_base: ["mobility", "easy_aerobic", "skill_technique", "strength"],
  bridge: ["mobility", "easy_aerobic", "strength", "threshold"],
  performance: ["mobility", "easy_aerobic", "strength", "threshold", "race_pace", "hyrox_simulation"],
};


function resolvePhase(input: TrainingDecisionInput, signals: {
  raceSoon: boolean;
  softRecoveryLoad: boolean;
  highRecentStrain: boolean;
  lowLoad: boolean;
  beginner: boolean;
}): TrainingPhase {
  if (signals.lowLoad && signals.beginner) return "reset_repair";
  if (signals.softRecoveryLoad || signals.highRecentStrain || input.testTrend.direction === "declining") return "aerobic_base";
  if (!signals.softRecoveryLoad && !signals.highRecentStrain && input.testTrend.direction === "improving" && !signals.beginner) return "performance";
  if (signals.raceSoon || input.testTrend.direction === "improving") return "bridge";
  return "aerobic_base";
}

/**
 * Deterministic 8-step training-state decision tree.
 * The returned outputs are intended to be the single source of truth for
 * downstream analysis and prescription.
 */
export function decideTrainingState(input: TrainingDecisionInput): TrainingDecision {
  const codes: string[] = [];

  // STEP 1 — Hard recovery stop.
  const hardRecoveryStop = Boolean(input.recoveryMarkers.illnessFlag)
    || input.recoveryMarkers.soreness === "high"
    || (input.recoveryMarkers.restingHrDelta ?? 0) >= 8;
  if (hardRecoveryStop) {
    codes.push("S1_HARD_RECOVERY_STOP");
    return {
      phase: "reset_repair",
      allowedWorkoutTypes: BASE_ALLOWED.reset_repair,
      intensityPermitted: false,
      rationaleCodes: codes,
    };
  }

  // STEP 2 — Soft recovery gating.
  const softRecoveryLoad = input.recoveryMarkers.sleepQuality === "poor"
    || input.recoveryMarkers.soreness === "medium"
    || (input.recoveryMarkers.restingHrDelta ?? 0) >= 4;
  if (softRecoveryLoad) codes.push("S2_SOFT_RECOVERY_GUARD");

  // STEP 3 — Race-week protection.
  const daysToRace = input.raceContext.daysToRace ?? null;
  const raceWeek = input.raceContext.hasRace && daysToRace != null && daysToRace <= 7;
  if (raceWeek) {
    codes.push("S3_RACE_WEEK");
    return {
      phase: "performance",
      allowedWorkoutTypes: ["mobility", "easy_aerobic", "race_pace"],
      intensityPermitted: false,
      rationaleCodes: codes,
    };
  }

  // STEP 4 — Near-race bridge window.
  const raceSoon = input.raceContext.hasRace && daysToRace != null && daysToRace <= 28;
  if (raceSoon) codes.push("S4_RACE_SOON");

  // STEP 5 — Training-load readiness (from recency + effort).
  const lowLoad = input.latestWorkouts.completedLast7d <= 1;
  const highRecentStrain = (input.latestWorkouts.avgRpeLast3 ?? 0) >= 8;
  if (lowLoad) codes.push("S5_LOW_RECENT_LOAD");
  if (highRecentStrain) codes.push("S5_HIGH_RECENT_STRAIN");

  // STEP 6 — Fitness trend (tests).
  if (input.testTrend.direction === "declining") codes.push("S6_TEST_DECLINE");
  if (input.testTrend.direction === "improving") codes.push("S6_TEST_IMPROVING");

  // STEP 7 — Athlete profile modulation.
  const beginner = input.profile.experienceLevel === "beginner";
  if (beginner) codes.push("S7_BEGINNER_PROFILE");

  // STEP 8 — Final phase assignment.
  const phase = resolvePhase(input, {
    raceSoon,
    softRecoveryLoad,
    highRecentStrain,
    lowLoad,
    beginner,
  });

  const intensityPermitted = phase === "bridge" || phase === "performance";
  const intensityAllowedAfterGuards = intensityPermitted && !softRecoveryLoad;
  if (!intensityAllowedAfterGuards) codes.push("S8_INTENSITY_BLOCKED");
  else codes.push("S8_INTENSITY_ALLOWED");

  return {
    phase,
    allowedWorkoutTypes: BASE_ALLOWED[phase],
    intensityPermitted: intensityAllowedAfterGuards,
    rationaleCodes: codes,
  };
}
