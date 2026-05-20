import type { WorkoutStatus } from "../enums";
import { customExercises, exerciseSets, workoutLogs, workoutStructureBlocks } from "../tables";
import { createInsertSchema, z } from "../zod";
import type { CoachNoteInputs } from "./plans";
// Workout log types and schemas
// Reject workout dates more than 24h in the future. A 24h grace window lets
// Strava/Garmin activities that straddle midnight in the user's timezone
// still land, while preventing users from logging genuinely future workouts
// (which otherwise skew Week-over-Week deltas and completion stats).
const workoutDateNotFuture = z.string().refine(
  (d) => {
    const target = new Date(`${d}T00:00:00Z`).getTime();
    if (Number.isNaN(target)) return false;
    return target <= Date.now() + 24 * 60 * 60 * 1000;
  },
  { message: "Workout date cannot be in the future" },
);

export const insertWorkoutLogSchema = createInsertSchema(workoutLogs)
  .omit({
    id: true,
    userId: true,
    prescribedMainWorkout: true,
    prescribedAccessory: true,
    prescribedNotes: true,
    plannedSetCount: true,
    actualSetCount: true,
    matchedSetCount: true,
    addedSetCount: true,
    removedSetCount: true,
    compliancePct: true,
  })
  .extend({
    date: workoutDateNotFuture,
    rpe: z
      .number()
      .int()
      .min(1, "RPE must be at least 1")
      .max(10, "RPE must be at most 10")
      .optional()
      .nullable(),
  });

export const updateWorkoutLogSchema = insertWorkoutLogSchema.partial().extend({
  prescribedMainWorkout: z.string().optional().nullable(),
  prescribedAccessory: z.string().optional().nullable(),
  prescribedNotes: z.string().optional().nullable(),
});

export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type UpdateWorkoutLog = z.infer<typeof updateWorkoutLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;
export type WorkoutStructureBlock = typeof workoutStructureBlocks.$inferSelect;

// Exercise set types and schemas
export const insertExerciseSetSchema = createInsertSchema(exerciseSets).omit({
  id: true,
});

export type InsertExerciseSet = z.infer<typeof insertExerciseSetSchema>;
export type ExerciseSet = typeof exerciseSets.$inferSelect;

export type TimelineEntry = {
  id: string;
  date: string;
  type: "planned" | "logged";
  status: WorkoutStatus;
  focus: string;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  duration?: number | null;
  rpe?: number | null;
  planDayId?: string | null;
  workoutLogId?: string | null;
  weekNumber?: number;
  dayName?: string;
  planName?: string | null;
  planId?: string | null;
  source?: "manual" | "strava" | "garmin";
  aiSource?: "rag" | "legacy" | "review" | null;
  aiRationale?: string | null;
  aiNoteUpdatedAt?: string | Date | null;
  aiInputsUsed?: CoachNoteInputs | null;
  exerciseSets?: ExerciseSet[];
  structureBlocks?: StructureBlockInput[];
  calories?: number | null;
  distanceMeters?: number | null;
  elevationGain?: number | null;
  avgHeartrate?: number | null;
  maxHeartrate?: number | null;
  avgSpeed?: number | null;
  maxSpeed?: number | null;
  avgCadence?: number | null;
  avgWatts?: number | null;
  sufferScore?: number | null;
  plannedSetCount?: number | null;
  actualSetCount?: number | null;
  matchedSetCount?: number | null;
  addedSetCount?: number | null;
  removedSetCount?: number | null;
  compliancePct?: number | null;
};

// Custom exercise types and schemas
export const insertCustomExerciseSchema = createInsertSchema(customExercises)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(100, "Name must be 100 characters or less"),
    category: z.string().trim().max(50, "Category must be 50 characters or less").optional(),
  });

export type InsertCustomExercise = z.infer<typeof insertCustomExerciseSchema>;
export type CustomExercise = typeof customExercises.$inferSelect;

const setStructureMetadataFieldsOptional = {
  blockId: z.string().max(255).optional().nullable(),
  stepNumber: z.number().int().min(1).max(10_000).optional().nullable(),
  intervalMinute: z.number().int().min(0).max(10_000).optional().nullable(),
  cycleNumber: z.number().int().min(1).max(10_000).optional().nullable(),
  stepRole: z.string().max(50).optional().nullable(),
  groupId: z.string().max(255).optional().nullable(),
  intensity: z.record(z.string(), z.unknown()).optional().nullable(),
  load: z.record(z.string(), z.unknown()).optional().nullable(),
  repMode: z.enum(["total", "per_side"]).optional().nullable(),
  tempo: z.record(z.string(), z.unknown()).optional().nullable(),
  standards: z.record(z.string(), z.unknown()).optional().nullable(),
};

function hasExactlyOne(a: unknown, b: unknown): boolean {
  return (a == null) !== (b == null);
}

function withBlockStepPairing<T extends { blockId?: string | null; stepNumber?: number | null }>(
  schema: z.ZodType<T>,
) {
  return schema.refine((value) => !hasExactlyOne(value.blockId, value.stepNumber), {
    message: "blockId and stepNumber must be provided together (or both omitted).",
    path: ["stepNumber"],
  });
}

function withPatchBlockStepPresencePairing<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
) {
  return schema.refine(
    (value) => {
      const hasBlockId = Object.hasOwn(value, "blockId");
      const hasStepNumber = Object.hasOwn(value, "stepNumber");
      return hasBlockId === hasStepNumber;
    },
    {
      message: "PATCH updates must include both blockId and stepNumber together.",
      path: ["stepNumber"],
    },
  );
}

export const exerciseSetSchema = withBlockStepPairing(
  z
    .object({
      setNumber: z.number().min(1).max(100).optional().nullable(),
      reps: z.number().min(0).max(10_000).optional().nullable(),
      weight: z.number().min(0).max(2_000).optional().nullable(),
      distance: z.number().min(0).max(1_000_000).optional().nullable(),
      time: z.number().min(0).max(86_400).optional().nullable(),
      // Planned (prescribed) values, captured at log creation. Optional so
      // ad-hoc logs without a prescription can simply omit them. Same numeric
      // bounds as the actual fields to keep validation symmetric.
      plannedReps: z.number().min(0).max(10_000).optional().nullable(),
      plannedWeight: z.number().min(0).max(2_000).optional().nullable(),
      plannedDistance: z.number().min(0).max(1_000_000).optional().nullable(),
      plannedTime: z.number().min(0).max(86_400).optional().nullable(),
      ...setStructureMetadataFieldsOptional,
      notes: z.string().max(1000).optional().nullable(),
    })
    .strip(),
);

export const incomingExerciseSchema = withBlockStepPairing(
  z
    .object({
      exerciseName: z.string().min(1).max(255),
      customLabel: z.string().max(255).optional().nullable(),
      category: z.string().max(50).optional().nullable(),
      numSets: z.number().min(1).max(50).optional().nullable(),
      reps: z.number().min(1).max(10_000).optional().nullable(),
      weight: z.number().min(0).max(2_000).optional().nullable(),
      distance: z.number().min(0).max(1_000_000).optional().nullable(),
      time: z.number().min(0).max(86_400).optional().nullable(),
      plannedReps: z.number().min(0).max(10_000).optional().nullable(),
      plannedWeight: z.number().min(0).max(2_000).optional().nullable(),
      plannedDistance: z.number().min(0).max(1_000_000).optional().nullable(),
      plannedTime: z.number().min(0).max(86_400).optional().nullable(),
      ...setStructureMetadataFieldsOptional,
      confidence: z.number().min(0).max(100).optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
      sets: z.array(exerciseSetSchema).max(50).optional().nullable(),
    })
    .strip(),
);

export const exercisesPayloadSchema = z.array(incomingExerciseSchema).max(200);

export const sectionTypeSchema = z.enum([
  "warmup",
  "activation",
  "main",
  "accessory",
  "cooldown",
  "mobility",
]);
export const formatTypeSchema = z.enum([
  "steady",
  "emom",
  "amrap",
  "rounds",
  "interval",
  "for_time",
  "quality",
]);
export const structureStepTypeSchema = z.enum(["work", "rest", "transition"]);

const structureStepTargetsSchema = z
  .object({
    targetReps: z.number().int().min(0).max(10_000).optional().nullable(),
    targetTime: z.number().min(0).max(86_400).optional().nullable(),
    targetDistance: z.number().min(0).max(1_000_000).optional().nullable(),
    targetWeight: z.number().min(0).max(2_000).optional().nullable(),
    reps: z.number().int().min(0).max(10_000).optional().nullable(),
    time: z.number().min(0).max(86_400).optional().nullable(),
    distance: z.number().min(0).max(1_000_000).optional().nullable(),
    weight: z.number().min(0).max(2_000).optional().nullable(),
  })
  .passthrough()
  .optional()
  .nullable();
const structureStepSchema = z
  .object({
    stepNumber: z.number().int().min(1).max(10_000),
    minuteIndex: z.number().int().min(1).max(10_000).optional().nullable(),
    stepType: structureStepTypeSchema.default("work"),
    exerciseName: z.string().min(1).max(255).optional().nullable(),
    category: z.string().max(255).optional().nullable(),
    customLabel: z.string().max(255).optional().nullable(),
    stepRole: z.string().max(50).optional().nullable(),
    intensity: z.record(z.string(), z.unknown()).optional().nullable(),
    loadMode: z.string().max(50).optional().nullable(),
    unilateralMode: z.string().max(50).optional().nullable(),
    tempo: z.record(z.string(), z.unknown()).optional().nullable(),
    constraintTags: z.array(z.string().min(1).max(50)).max(20).optional().nullable(),
    groupId: z.string().max(255).optional().nullable(),
    groupMeta: z.record(z.string(), z.unknown()).optional().nullable(),
    targets: structureStepTargetsSchema,
  })
  .strip()
  .superRefine((step, ctx) => {
    if (step.stepType === "rest") {
      const hasExercise = step.exerciseName != null || step.customLabel != null;
      const t = step.targets ?? {};
      const hasTargets = [
        t.targetReps,
        t.targetTime,
        t.targetDistance,
        t.targetWeight,
        t.reps,
        t.time,
        t.distance,
        t.weight,
      ].some((v) => v != null);
      if (hasExercise || hasTargets) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rest steps cannot include exercise or performance targets.",
        });
      }
    }
    if (step.stepType === "work" && !step.exerciseName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Work steps require exerciseName.",
        path: ["exerciseName"],
      });
    }
  });

export const structureBlockScoreSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("emom"),
      completed: z.boolean(),
      completedMinutes: z.number().int().min(0).max(1_440).optional().nullable(),
      missedReps: z.number().int().min(0).max(10_000).optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    })
    .strip(),
  z
    .object({
      type: z.literal("amrap"),
      rounds: z.number().int().min(0).max(10_000),
      reps: z.number().int().min(0).max(10_000).optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    })
    .strip(),
  z
    .object({
      type: z.literal("rounds"),
      completedRounds: z.number().int().min(0).max(10_000),
      elapsedSeconds: z.number().int().min(0).max(86_400).optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    })
    .strip(),
]);
export type StructureBlockScore = z.infer<typeof structureBlockScoreSchema>;

const structureBlockBaseSchema = z.object({
  id: z.string().max(255).optional(),
  sectionType: sectionTypeSchema,
  formatType: formatTypeSchema,
  durationMinutes: z.number().int().min(1).max(1_440).optional().nullable(),
  roundCount: z.number().int().min(1).max(10_000).optional().nullable(),
  timeCapMinutes: z.number().int().min(1).max(1_440).optional().nullable(),
  durationSeconds: z.number().int().min(0).max(86_400).optional().nullable(),
  rounds: z.number().int().min(1).max(10_000).optional().nullable(),
  workSeconds: z.number().int().min(0).max(86_400).optional().nullable(),
  restSeconds: z.number().int().min(0).max(86_400).optional().nullable(),
  workIntervalSec: z.number().int().min(0).max(86_400).optional().nullable(),
  restIntervalSec: z.number().int().min(0).max(86_400).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  score: structureBlockScoreSchema.optional().nullable(),
  sequenceOrder: z.number().int().min(0).max(10_000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  steps: z.array(structureStepSchema).min(1).max(200),
});
type StructureBlockDraft = z.infer<typeof structureBlockBaseSchema>;
type StructureBlockValidator = (block: StructureBlockDraft, ctx: z.RefinementCtx) => void;

function validateEmomBlock(block: StructureBlockDraft, ctx: z.RefinementCtx): void {
  if (block.formatType !== "emom") return;
  if (!block.durationMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "EMOM blocks require durationMinutes.",
      path: ["durationMinutes"],
    });
  }
  if (block.steps.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "EMOM blocks require at least one step.",
      path: ["steps"],
    });
  }
  const minuteIndices = block.steps.map((s) => s.minuteIndex).filter((m): m is number => m != null);
  if (minuteIndices.length !== block.steps.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "EMOM steps require minuteIndex.",
      path: ["steps"],
    });
  }
  if (minuteIndices.length !== new Set(minuteIndices).size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Duplicate minuteIndex values are not allowed in EMOM patterns.",
      path: ["steps"],
    });
  }
}

function validateAmrapBlock(block: StructureBlockDraft, ctx: z.RefinementCtx): void {
  if (block.formatType === "amrap" && block.roundCount != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AMRAP blocks cannot define fixed roundCount.",
      path: ["roundCount"],
    });
  }
  if (
    block.formatType === "amrap" &&
    !block.timeCapMinutes &&
    !block.durationSeconds &&
    !block.durationMinutes
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AMRAP blocks require a time cap or duration.",
      path: ["timeCapMinutes"],
    });
  }
}

function validateRoundsBlock(block: StructureBlockDraft, ctx: z.RefinementCtx): void {
  if (block.formatType === "rounds" && block.roundCount == null && block.rounds == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Rounds blocks require roundCount.",
      path: ["roundCount"],
    });
  }
}

function validateTimedBlock(block: StructureBlockDraft, ctx: z.RefinementCtx): void {
  if (block.formatType === "for_time" && !block.timeCapMinutes && !block.durationSeconds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "for_time blocks must define timeCapMinutes.",
      path: ["timeCapMinutes"],
    });
  }
  if (block.roundCount != null && block.durationMinutes != null && block.formatType === "steady") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "steady blocks cannot define both roundCount and durationMinutes.",
    });
  }
  if (block.score && block.score.type !== block.formatType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Block score type must match the block format.",
      path: ["score"],
    });
  }
}

const structureBlockValidators: StructureBlockValidator[] = [
  validateEmomBlock,
  validateAmrapBlock,
  validateRoundsBlock,
  validateTimedBlock,
];

export const structureBlockSchema = structureBlockBaseSchema.superRefine((block, ctx) => {
  for (const validate of structureBlockValidators) validate(block, ctx);
});

export const structureBlocksPayloadSchema = z.array(structureBlockSchema).max(100).optional();

export type StructureBlockInput = z.infer<typeof structureBlockSchema>;

// Shared measurement fields used by both patch and add request bodies.
// Extracted to a single definition so the 9-line block doesn't duplicate.
//
// Planned fields are intentionally NOT exposed in the per-set request bodies:
// the prescription baseline is set once at log-materialisation time
// (server/storage/shared.ts#prescribedSetToLogRow) and must not be mutable
// via the per-set CRUD routes — otherwise any client could overwrite the
// prescription baseline after a log is created and corrupt downstream
// plan-vs-actual adherence reporting.
const measurableSetFields = {
  reps: z.number().int().min(0).max(10_000).nullable().optional(),
  weight: z.number().min(0).max(2_000).nullable().optional(),
  distance: z.number().min(0).max(1_000_000).nullable().optional(),
  time: z.number().min(0).max(86_400).nullable().optional(),
  ...setStructureMetadataFieldsOptional,
  notes: z.string().max(1000).nullable().optional(),
};

// Discriminated ownership for set-level routes and callers that may target
// either a logged workout or a planned day. Exported from shared schema so
// both server and client code narrow safely via `ownerType`.

export type ExerciseSetOwner =
  | {
      ownerType: "workout-log";
      workoutLogId: string;
      planDayId?: null;
    }
  | {
      ownerType: "plan-day";
      planDayId: string;
      workoutLogId?: null;
    };

// Request bodies for the set-level CRUD routes. Shared between the
// workout-log routes (server/routes/workouts.ts) and the plan-day routes
// (server/routes/plans.ts) so a single numeric-bounds contract covers
// both paths — one schema, one Sonar-visible definition.
const disallowLegacyEmomRowName = <T extends z.ZodType<{ exerciseName?: unknown }>>(schema: T) =>
  schema.refine(
    (value) => {
      const candidate = value.exerciseName;
      if (typeof candidate !== "string") return true;
      return candidate.trim().toLowerCase() !== "emom";
    },
    {
      message:
        "exerciseName 'emom' is not allowed for row payloads. Use structured interval blocks instead.",
      path: ["exerciseName"],
    },
  );

export const patchExerciseSetBodySchema = disallowLegacyEmomRowName(
  withPatchBlockStepPresencePairing(
    withBlockStepPairing(
      z.object({
        exerciseName: z.string().min(1).max(255).optional(),
        customLabel: z.string().max(255).nullable().optional(),
        category: z.string().max(50).optional(),
        setNumber: z.number().int().min(1).max(100).optional(),
        ...measurableSetFields,
        sortOrder: z.number().int().nullable().optional(),
      }),
    ),
  ),
);
export type PatchExerciseSetBody = z.infer<typeof patchExerciseSetBodySchema>;

export const addExerciseSetBodySchema = disallowLegacyEmomRowName(
  withBlockStepPairing(
    z.object({
      exerciseName: z.string().min(1).max(255),
      customLabel: z.string().max(255).nullable().optional(),
      category: z.string().max(50),
      setNumber: z.number().int().min(1).max(100).default(1),
      ...measurableSetFields,
      confidence: z.number().int().min(0).max(100).nullable().optional(),
    }),
  ),
);
export type AddExerciseSetBody = z.infer<typeof addExerciseSetBodySchema>;

export interface ParsedExercise extends ParsedExerciseSetStructureMetadata {
  exerciseName: string;
  category: string;
  customLabel?: string;
  confidence?: number;
  missingFields?: string[];
  numSets?: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  plannedReps?: number;
  plannedWeight?: number;
  plannedDistance?: number;
  plannedTime?: number;
  notes?: string;
  sets: Array<ParsedExerciseSet>;
}

interface ParsedExerciseSetStructureMetadata {
  blockId?: string;
  stepNumber?: number;
  intervalMinute?: number;
  cycleNumber?: number;
  stepRole?: string;
  groupId?: string;
  intensity?: Record<string, unknown>;
  load?: Record<string, unknown>;
  repMode?: "total" | "per_side";
  tempo?: Record<string, unknown>;
  standards?: Record<string, unknown>;
}

type ParsedExerciseSet = ParsedExerciseSetStructureMetadata & {
  setNumber: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  plannedReps?: number;
  plannedWeight?: number;
  plannedDistance?: number;
  plannedTime?: number;
  notes?: string;
};

export interface PersonalRecordValue {
  value: number;
  date: string;
  workoutLogId: string;
}

export interface PersonalRecord {
  category: string;
  customLabel?: string | null;
  maxWeight?: PersonalRecordValue;
  maxDistance?: PersonalRecordValue;
  bestTime?: PersonalRecordValue;
  estimated1RM?: PersonalRecordValue;
}

export type PersonalRecordMetric = "maxWeight" | "maxDistance" | "bestTime" | "estimated1RM";

export interface PersonalRecordAchievement {
  exerciseKey: string;
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  metric: PersonalRecordMetric;
  metricLabel: string;
  value: number;
  previousValue: number;
  date: string;
  workoutLogId: string;
}

