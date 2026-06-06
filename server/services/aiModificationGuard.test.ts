import type { CoachNoteInputs, InsertExerciseSet } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext, UpcomingWorkout } from "../gemini";
import {
  buildSignalsFromCoachInputs,
  buildSignalsFromTrainingContext,
  buildStructuredResultingWorkout,
  buildTextResultingWorkout,
  buildWorkoutPrescriptionFingerprint,
  classifyCoachModification,
  type CoachModificationInput,
  type CoachModificationSignals,
  mapExerciseSetToPromptDetail,
  shouldSuppressRepeatedFatigueReduction,
  withCoachModificationMetadata,
} from "./aiModificationGuard";

// Stable wall-clock so the `at` ISO string baked into the metadata is
// deterministic across CI runs.
const FROZEN_NOW = new Date("2026-06-06T12:00:00Z");

function workout(overrides: Partial<UpcomingWorkout> = {}): UpcomingWorkout {
  return {
    id: "workout-1",
    date: "2026-05-22",
    focus: "Strength",
    mainWorkout: "Heavy lift",
    ...overrides,
  };
}

function suggestion(overrides: Partial<CoachModificationInput> = {}): CoachModificationInput {
  return {
    workoutId: "workout-1",
    targetField: "mainWorkout",
    action: "replace",
    recommendation: "Replace today's main set with conversational easy work.",
    rationale: "RPE is rising — reduce volume to recover before tomorrow.",
    ...overrides,
  };
}

function row(overrides: Partial<InsertExerciseSet> = {}): InsertExerciseSet {
  return {
    planDayId: "plan-day-1",
    workoutLogId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: 5,
    weight: 100,
    distance: null,
    time: null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    notes: null,
    confidence: null,
    sortOrder: 0,
    ...overrides,
  };
}

function trainingContext(overrides: Partial<TrainingContext> = {}): TrainingContext {
  return {
    totalWorkouts: 0,
    completedWorkouts: 0,
    plannedWorkouts: 0,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    completionRate: 0,
    currentStreak: 0,
    recentWorkouts: [],
    exerciseBreakdown: {},
    ...overrides,
  };
}

describe("mapExerciseSetToPromptDetail", () => {
  it("maps fully-populated rows into the prompt shape", () => {
    const result = mapExerciseSetToPromptDetail(
      row({
        exerciseName: "deadlift",
        customLabel: "Trap-bar",
        category: "strength",
        setNumber: 3,
        reps: 5,
        weight: 200,
        distance: 0,
        time: 0,
        notes: "Top set of the day",
        sortOrder: 2,
      }),
    );
    expect(result).toEqual({
      exerciseName: "deadlift",
      customLabel: "Trap-bar",
      category: "strength",
      setNumber: 3,
      reps: 5,
      weight: 200,
      distance: 0,
      time: 0,
      notes: "Top set of the day",
      sortOrder: 2,
    });
  });

  it("defaults every optional field to null when missing", () => {
    // We intentionally pass a sparse object — the helper should fill missing
    // optionals with explicit nulls so the prompt shape stays consistent.
    const result = mapExerciseSetToPromptDetail({
      exerciseName: "kettlebell_swings",
      category: "conditioning",
    });
    expect(result).toEqual({
      exerciseName: "kettlebell_swings",
      customLabel: null,
      category: "conditioning",
      setNumber: null,
      reps: null,
      weight: null,
      distance: null,
      time: null,
      notes: null,
      sortOrder: null,
    });
  });
});

describe("buildStructuredResultingWorkout", () => {
  it("replace overwrites the entire exerciseDetails array", () => {
    const result = buildStructuredResultingWorkout(
      workout({
        exerciseDetails: [{ exerciseName: "back_squat", category: "strength", setNumber: 1 }],
      }),
      "replace",
      [row({ exerciseName: "recovery_run", category: "running" })],
    );
    expect(result.exerciseDetails).toHaveLength(1);
    expect(result.exerciseDetails?.[0].exerciseName).toBe("recovery_run");
  });

  it("append concatenates new rows after existing exerciseDetails", () => {
    const result = buildStructuredResultingWorkout(
      workout({
        exerciseDetails: [{ exerciseName: "back_squat", category: "strength", setNumber: 1 }],
      }),
      "append",
      [row({ exerciseName: "calf_raise", category: "strength", setNumber: 1 })],
    );
    expect(result.exerciseDetails?.map((e) => e.exerciseName)).toEqual([
      "back_squat",
      "calf_raise",
    ]);
  });

  it("append treats undefined existing exerciseDetails as an empty base", () => {
    const result = buildStructuredResultingWorkout(
      workout({ exerciseDetails: undefined }),
      "append",
      [row({ exerciseName: "recovery_run", category: "running" })],
    );
    expect(result.exerciseDetails?.map((e) => e.exerciseName)).toEqual(["recovery_run"]);
  });

  it("preserves all non-exerciseDetails fields on the workout", () => {
    const result = buildStructuredResultingWorkout(
      workout({ id: "abc", focus: "Cardio", notes: "be careful" }),
      "replace",
      [row({ exerciseName: "recovery_run", category: "running" })],
    );
    expect(result.id).toBe("abc");
    expect(result.focus).toBe("Cardio");
    expect(result.notes).toBe("be careful");
  });
});

describe("buildTextResultingWorkout", () => {
  it.each([
    ["mainWorkout" as const, "new main"],
    ["accessory" as const, "new accessory"],
    ["notes" as const, "new notes"],
  ])("writes %s = %s while preserving the other fields", (field, value) => {
    const result = buildTextResultingWorkout(
      workout({ mainWorkout: "old main", accessory: "old acc", notes: "old notes" }),
      field,
      value,
    );
    expect(result[field]).toBe(value);
    expect(result.id).toBe("workout-1");
    expect(result.focus).toBe("Strength");
  });
});

describe("buildWorkoutPrescriptionFingerprint", () => {
  it("returns undefined for null/undefined workouts", () => {
    expect(buildWorkoutPrescriptionFingerprint(null)).toBeUndefined();
    expect(buildWorkoutPrescriptionFingerprint(undefined)).toBeUndefined();
  });

  it("returns a 64-character sha256 hex string for any workout", () => {
    const fp = buildWorkoutPrescriptionFingerprint(workout());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same fingerprint for identical workouts (determinism)", () => {
    const a = buildWorkoutPrescriptionFingerprint(workout());
    const b = buildWorkoutPrescriptionFingerprint(workout());
    expect(a).toBe(b);
  });

  it("ignores exerciseDetails ordering (the helper sorts before hashing)", () => {
    const exA = { exerciseName: "back_squat", category: "strength", setNumber: 1 };
    const exB = { exerciseName: "deadlift", category: "strength", setNumber: 1 };
    const a = buildWorkoutPrescriptionFingerprint(workout({ exerciseDetails: [exA, exB] }));
    const b = buildWorkoutPrescriptionFingerprint(workout({ exerciseDetails: [exB, exA] }));
    expect(a).toBe(b);
  });

  it("ignores leading/trailing whitespace and collapses runs of whitespace", () => {
    const tidy = buildWorkoutPrescriptionFingerprint(
      workout({ mainWorkout: "Heavy deadlift triples", notes: "go" }),
    );
    const messy = buildWorkoutPrescriptionFingerprint(
      workout({ mainWorkout: "  Heavy   deadlift   triples  ", notes: "  go  " }),
    );
    expect(tidy).toBe(messy);
  });

  it("treats whitespace-only fields as null (still equal to omitted)", () => {
    const omitted = buildWorkoutPrescriptionFingerprint(workout({ accessory: undefined }));
    const blank = buildWorkoutPrescriptionFingerprint(workout({ accessory: "   " }));
    expect(omitted).toBe(blank);
  });

  it("produces different fingerprints when the prescription text changes", () => {
    const a = buildWorkoutPrescriptionFingerprint(
      workout({ mainWorkout: "Heavy deadlift triples" }),
    );
    const b = buildWorkoutPrescriptionFingerprint(workout({ mainWorkout: "Light pause squats" }));
    expect(a).not.toBe(b);
  });

  it("produces different fingerprints when an exercise detail changes", () => {
    const a = buildWorkoutPrescriptionFingerprint(
      workout({
        exerciseDetails: [
          { exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5 },
        ],
      }),
    );
    const b = buildWorkoutPrescriptionFingerprint(
      workout({
        exerciseDetails: [
          { exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 8 },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe("classifyCoachModification", () => {
  const fatigueSignals: CoachModificationSignals = {
    coachingInsights: { fatigueFlag: true },
  };
  const risingRpeSignals: CoachModificationSignals = {
    coachingInsights: { rpeTrend: "rising" },
  };

  it("returns null when targetField is 'notes'", () => {
    expect(
      classifyCoachModification(suggestion({ targetField: "notes" }), fatigueSignals),
    ).toBeNull();
  });

  it("returns null when recommendation is missing", () => {
    expect(
      classifyCoachModification(suggestion({ recommendation: undefined }), fatigueSignals),
    ).toBeNull();
  });

  it("returns null when recommendation is whitespace-only", () => {
    expect(
      classifyCoachModification(suggestion({ recommendation: "    \n\t  " }), fatigueSignals),
    ).toBeNull();
  });

  it("returns 'fatigue_volume_reduction' when fatigueFlag + fatigue term + reduction term align", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "RPE has been climbing — let's recover.",
        }),
        fatigueSignals,
      ),
    ).toBe("fatigue_volume_reduction");
  });

  it("treats a rising rpeTrend (with no explicit fatigueFlag) as an active fatigue signal", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "Lower the intensity and recover.",
          rationale: undefined,
        }),
        risingRpeSignals,
      ),
    ).toBe("fatigue_volume_reduction");
  });

  it("is case-insensitive over both fatigue and reduction vocabulary", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "REDUCE the LOAD",
          rationale: "RPE TRENDING UP, athlete looks TIRED",
        }),
        fatigueSignals,
      ),
    ).toBe("fatigue_volume_reduction");
  });

  it("falls back to 'workload_adjustment' when fatigue signal is absent", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recovery needed",
        }),
        { coachingInsights: { fatigueFlag: false, rpeTrend: "stable" } },
      ),
    ).toBe("workload_adjustment");
  });

  it("falls back to 'workload_adjustment' when no reduction vocabulary is present", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "Add a tempo block at the end",
          rationale: "RPE is rising and athlete is tired",
        }),
        fatigueSignals,
      ),
    ).toBe("workload_adjustment");
  });

  it("falls back to 'workload_adjustment' when no fatigue vocabulary is present", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Schedule conflict",
        }),
        fatigueSignals,
      ),
    ).toBe("workload_adjustment");
  });

  it("treats missing coachingInsights as no active fatigue signal", () => {
    expect(
      classifyCoachModification(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "fatigue noted",
        }),
        {},
      ),
    ).toBe("workload_adjustment");
  });
});

describe("shouldSuppressRepeatedFatigueReduction", () => {
  const fatigueSignals: CoachModificationSignals = {
    coachingInsights: { fatigueFlag: true },
  };

  function priorReductionInputs(fingerprint: string, completedWorkoutCount = 4): CoachNoteInputs {
    return {
      lastFatigueReduction: {
        kind: "fatigue_volume_reduction",
        at: "2026-05-20T00:00:00Z",
        completedWorkoutCount,
        prescriptionFingerprint: fingerprint,
      },
    };
  }

  it("returns false when the modification would not classify as fatigue reduction", () => {
    const target = workout();
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({ targetField: "notes" }),
        target,
        fatigueSignals,
      ),
    ).toBe(false);
  });

  it("returns false when the workout argument is undefined", () => {
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        undefined,
        fatigueSignals,
      ),
    ).toBe(false);
  });

  it("returns false when no prior fatigue reduction has been recorded", () => {
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        workout({ aiInputsUsed: null }),
        fatigueSignals,
      ),
    ).toBe(false);
  });

  it("returns false when prior fingerprint is missing (cannot prove the prescription is unchanged)", () => {
    const target = workout({
      aiInputsUsed: {
        lastFatigueReduction: {
          kind: "fatigue_volume_reduction",
          completedWorkoutCount: 2,
        },
      },
    });
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        target,
        fatigueSignals,
      ),
    ).toBe(false);
  });

  it("returns true when prior fingerprint matches the current prescription", () => {
    const target = workout({ mainWorkout: "Heavy deadlift triples" });
    const fingerprint = buildWorkoutPrescriptionFingerprint(target)!;
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        { ...target, aiInputsUsed: priorReductionInputs(fingerprint, 4) },
        { coachingInsights: { fatigueFlag: true }, completedWorkouts: 4 },
      ),
    ).toBe(true);
  });

  it("returns false when athlete has completed MORE workouts since the prior reduction", () => {
    const target = workout({ mainWorkout: "Heavy deadlift triples" });
    const fingerprint = buildWorkoutPrescriptionFingerprint(target)!;
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        { ...target, aiInputsUsed: priorReductionInputs(fingerprint, 4) },
        { coachingInsights: { fatigueFlag: true }, completedWorkouts: 5 },
      ),
    ).toBe(false);
  });

  it("returns false when prescriptions differ even if fatigue + prior + count gates pass", () => {
    const target = workout({ mainWorkout: "Heavy deadlift triples" });
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        { ...target, aiInputsUsed: priorReductionInputs("some-other-hash", 4) },
        { coachingInsights: { fatigueFlag: true }, completedWorkouts: 4 },
      ),
    ).toBe(false);
  });

  it("derives a prior fatigue reduction from lastModification when lastFatigueReduction is missing", () => {
    const target = workout({ mainWorkout: "Heavy deadlift triples" });
    const fingerprint = buildWorkoutPrescriptionFingerprint(target)!;
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        {
          ...target,
          aiInputsUsed: {
            lastModification: {
              kind: "fatigue_volume_reduction",
              completedWorkoutCount: 4,
              prescriptionFingerprint: fingerprint,
            },
          },
        },
        { coachingInsights: { fatigueFlag: true }, completedWorkouts: 4 },
      ),
    ).toBe(true);
  });

  it("does NOT derive a prior fatigue reduction from a lastModification of kind=workload_adjustment", () => {
    const target = workout({ mainWorkout: "Heavy deadlift triples" });
    const fingerprint = buildWorkoutPrescriptionFingerprint(target)!;
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        {
          ...target,
          aiInputsUsed: {
            lastModification: {
              kind: "workload_adjustment",
              completedWorkoutCount: 4,
              prescriptionFingerprint: fingerprint,
            },
          },
        },
        { coachingInsights: { fatigueFlag: true }, completedWorkouts: 4 },
      ),
    ).toBe(false);
  });

  it("returns true when prior has no completedWorkoutCount (count gate skipped)", () => {
    const target = workout({ mainWorkout: "Heavy deadlift triples" });
    const fingerprint = buildWorkoutPrescriptionFingerprint(target)!;
    expect(
      shouldSuppressRepeatedFatigueReduction(
        suggestion({
          recommendation: "Reduce volume",
          rationale: "Recover from fatigue",
        }),
        {
          ...target,
          aiInputsUsed: {
            lastFatigueReduction: {
              kind: "fatigue_volume_reduction",
              prescriptionFingerprint: fingerprint,
            },
          },
        },
        { coachingInsights: { fatigueFlag: true }, completedWorkouts: 99 },
      ),
    ).toBe(true);
  });
});

describe("withCoachModificationMetadata", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the input unchanged when classification is null", () => {
    const inputs: CoachNoteInputs = { fatigueFlag: true };
    expect(
      withCoachModificationMetadata(inputs, suggestion({ targetField: "notes" }), {
        coachingInsights: { fatigueFlag: true },
      }),
    ).toBe(inputs);
  });

  it("attaches lastModification for a workload adjustment without overwriting lastFatigueReduction", () => {
    const result = withCoachModificationMetadata(
      {
        lastFatigueReduction: {
          kind: "fatigue_volume_reduction",
          completedWorkoutCount: 3,
        },
      },
      suggestion({
        recommendation: "Add an interval block",
        rationale: "Schedule shifted",
      }),
      { coachingInsights: { fatigueFlag: false }, completedWorkouts: 4 },
    );
    expect(result.lastModification?.kind).toBe("workload_adjustment");
    expect(result.completedWorkoutCount).toBe(4);
    expect(result.lastFatigueReduction?.completedWorkoutCount).toBe(3);
  });

  it("attaches BOTH lastModification and lastFatigueReduction for a fatigue reduction", () => {
    const result = withCoachModificationMetadata(
      {},
      suggestion({
        recommendation: "Reduce volume",
        rationale: "Recover from rising fatigue",
      }),
      { coachingInsights: { fatigueFlag: true }, completedWorkouts: 7 },
      workout(),
    );
    expect(result.lastModification?.kind).toBe("fatigue_volume_reduction");
    expect(result.lastFatigueReduction?.kind).toBe("fatigue_volume_reduction");
    expect(result.lastModification?.at).toBe(FROZEN_NOW.toISOString());
    expect(result.lastFatigueReduction?.at).toBe(FROZEN_NOW.toISOString());
  });

  it("stamps the resulting prescription's fingerprint on the metadata when provided", () => {
    const resulting = workout({ mainWorkout: "Recovery run" });
    const expectedFingerprint = buildWorkoutPrescriptionFingerprint(resulting);
    const result = withCoachModificationMetadata(
      {},
      suggestion({
        recommendation: "Reduce volume",
        rationale: "Recover from fatigue",
      }),
      { coachingInsights: { fatigueFlag: true }, completedWorkouts: 7 },
      resulting,
    );
    expect(result.lastModification?.prescriptionFingerprint).toBe(expectedFingerprint);
    expect(result.lastFatigueReduction?.prescriptionFingerprint).toBe(expectedFingerprint);
  });

  it("truncates the reason at 400 characters", () => {
    const longRationale = "x".repeat(500);
    const result = withCoachModificationMetadata(
      {},
      suggestion({ recommendation: "Reduce volume", rationale: longRationale }),
      { coachingInsights: { fatigueFlag: true } },
    );
    expect(result.lastModification?.reason).toHaveLength(400);
  });

  it("omits the reason when rationale is missing or empty", () => {
    const result = withCoachModificationMetadata(
      {},
      suggestion({ recommendation: "Reduce volume", rationale: "" }),
      { coachingInsights: { fatigueFlag: true } },
    );
    expect(result.lastModification?.reason).toBeUndefined();
  });

  it("for a workload adjustment, derives lastFatigueReduction from a prior lastModification fatigue entry", () => {
    const result = withCoachModificationMetadata(
      {
        lastModification: {
          kind: "fatigue_volume_reduction",
          completedWorkoutCount: 2,
          prescriptionFingerprint: "old-hash",
        },
      },
      suggestion({
        recommendation: "Add another set",
        rationale: "Schedule shift",
      }),
      { coachingInsights: { fatigueFlag: false }, completedWorkouts: 5 },
    );
    // Resolved from the prior lastModification.kind=fatigue (since
    // lastFatigueReduction is absent), so the metadata still tracks the
    // older fatigue reduction snapshot.
    expect(result.lastFatigueReduction?.kind).toBe("fatigue_volume_reduction");
    expect(result.lastFatigueReduction?.completedWorkoutCount).toBe(2);
    expect(result.lastModification?.kind).toBe("workload_adjustment");
  });
});

describe("buildSignalsFromTrainingContext", () => {
  it("extracts completedWorkouts and coachingInsights verbatim", () => {
    const ctx = trainingContext({
      completedWorkouts: 7,
      coachingInsights: {
        rpeTrend: "rising",
        fatigueFlag: true,
        undertrainingFlag: false,
        stationGaps: [],
        progressionFlags: [],
      },
    });
    expect(buildSignalsFromTrainingContext(ctx)).toEqual({
      completedWorkouts: 7,
      coachingInsights: ctx.coachingInsights,
    });
  });

  it("passes through undefined coachingInsights", () => {
    const ctx = trainingContext({ completedWorkouts: 0 });
    expect(buildSignalsFromTrainingContext(ctx)).toEqual({
      completedWorkouts: 0,
      coachingInsights: undefined,
    });
  });
});

describe("buildSignalsFromCoachInputs", () => {
  it("returns all undefined fields when inputsUsed is null/undefined", () => {
    expect(buildSignalsFromCoachInputs(null)).toEqual({
      completedWorkouts: undefined,
      coachingInsights: {
        fatigueFlag: undefined,
        rpeTrend: undefined,
      },
    });
    expect(buildSignalsFromCoachInputs(undefined)).toEqual({
      completedWorkouts: undefined,
      coachingInsights: {
        fatigueFlag: undefined,
        rpeTrend: undefined,
      },
    });
  });

  it("prefers direct fields on the inputs", () => {
    const result = buildSignalsFromCoachInputs({
      completedWorkoutCount: 9,
      fatigueFlag: true,
      rpeTrend: "rising",
      lastModification: {
        kind: "workload_adjustment",
        completedWorkoutCount: 1,
        fatigueFlag: false,
        rpeTrend: "stable",
      },
    });
    expect(result.completedWorkouts).toBe(9);
    expect(result.coachingInsights?.fatigueFlag).toBe(true);
    expect(result.coachingInsights?.rpeTrend).toBe("rising");
  });

  it("respects nullish-coalescing: a direct `false` stops the cascade", () => {
    // ?? only falls through for null/undefined — boolean false MUST stick.
    const result = buildSignalsFromCoachInputs({
      fatigueFlag: false,
      lastModification: {
        kind: "workload_adjustment",
        fatigueFlag: true,
      },
    });
    expect(result.coachingInsights?.fatigueFlag).toBe(false);
  });

  it("cascades from lastModification when direct field is missing", () => {
    const result = buildSignalsFromCoachInputs({
      lastModification: {
        kind: "workload_adjustment",
        completedWorkoutCount: 4,
        fatigueFlag: true,
        rpeTrend: "rising",
      },
    });
    expect(result.completedWorkouts).toBe(4);
    expect(result.coachingInsights?.fatigueFlag).toBe(true);
    expect(result.coachingInsights?.rpeTrend).toBe("rising");
  });

  it("cascades all the way to lastFatigueReduction when prior layers are missing", () => {
    const result = buildSignalsFromCoachInputs({
      lastFatigueReduction: {
        kind: "fatigue_volume_reduction",
        completedWorkoutCount: 2,
        fatigueFlag: true,
        rpeTrend: "rising",
      },
    });
    expect(result.completedWorkouts).toBe(2);
    expect(result.coachingInsights?.fatigueFlag).toBe(true);
    expect(result.coachingInsights?.rpeTrend).toBe("rising");
  });
});
