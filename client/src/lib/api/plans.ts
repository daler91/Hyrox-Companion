import type { ExerciseSet, GeneratePlanInput, PlanDay, StructureBlockInput, TrainingPlan, TrainingPlanWithDays } from "@shared/schema";

import { rawRequest,typedRequest } from "./client";
import { IMAGE_REPARSE_REQUEST_OPTIONS } from "./constants";
import type { ParseFromImagePayload } from "./exercises";
import { type AddExerciseSetPayload, createExerciseSetMutationApi, type PatchExerciseSetPayload } from "./exerciseSetMutations";

export const plans = {
  list: () => typedRequest<TrainingPlan[]>("GET", "/api/v1/plans"),

  get: (id: string) => typedRequest<TrainingPlan & { days: PlanDay[] }>("GET", `/api/v1/plans/${id}`),

  import: (data: { csvContent: string; fileName?: string; planName?: string }) =>
    typedRequest<TrainingPlan>("POST", "/api/v1/plans/import", data),

  createSample: () => typedRequest<TrainingPlan>("POST", "/api/v1/plans/sample", {}),

  rename: (planId: string, name: string) =>
    rawRequest("PATCH", `/api/v1/plans/${planId}`, { name }).then(() => undefined),

  updateGoal: (planId: string, goal: string | null) =>
    typedRequest<TrainingPlan>("PATCH", `/api/v1/plans/${planId}/goal`, { goal }),

  updateDay: (planId: string, dayId: string, updates: Partial<PlanDay>) =>
    typedRequest<PlanDay>("PATCH", `/api/v1/plans/${planId}/days/${dayId}`, updates),

  updateDayWithoutPlan: (dayId: string, updates: Record<string, unknown>) =>
    typedRequest<PlanDay>("PATCH", `/api/v1/plans/days/${dayId}`, updates),

  deleteDay: (dayId: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/plans/days/${dayId}`),

  schedule: (planId: string, startDate: string) =>
    rawRequest("POST", `/api/v1/plans/${planId}/schedule`, { startDate }).then(() => undefined),

  updateDayStatus: (dayId: string, status: string) =>
    typedRequest<PlanDay>("PATCH", `/api/v1/plans/days/${dayId}/status`, { status }),

  generate: (input: GeneratePlanInput) =>
    typedRequest<TrainingPlanWithDays>("POST", "/api/v1/plans/generate", input),

  // Plan-day prescribed exerciseSets — used by the v2 dialog when a
  // planned entry is open so the athlete can tweak the coach's
  // prescription before marking complete. Edits write back to the
  // plan day; Mark complete's server copy-from-plan path picks up
  // whatever the plan day has at mutation time.
  getDayExercises: (dayId: string) =>
    typedRequest<{ exerciseSets: ExerciseSet[]; structureBlocks: StructureBlockInput[] }>(
      "GET",
      `/api/v1/plans/days/${dayId}/sets?includeStructure=true`,
    ),

  updateDayStructure: (dayId: string, structureBlocks: StructureBlockInput[]) =>
    typedRequest<{ exerciseSets: ExerciseSet[]; structureBlocks: StructureBlockInput[] }>(
      "PATCH",
      `/api/v1/plans/days/${dayId}/structure`,
      { structureBlocks },
    ),

  ...(() => {
    const mutations = createExerciseSetMutationApi((dayId) => `/api/v1/plans/days/${dayId}`);
    return {
      addDayExercise: (dayId: string, data: AddExerciseSetPayload) => mutations.addSet(dayId, data),
      updateDayExercise: (dayId: string, setId: string, data: PatchExerciseSetPayload) => mutations.updateSet(dayId, setId, data),
      deleteDayExercise: (dayId: string, setId: string) => mutations.deleteSet(dayId, setId),
    };
  })(),

  // Manual coach-note refresh for a planned day. Triggered from CoachTakePanel
  // after the athlete edited the day's exercises so the static rationale
  // reflects the new prescription. Returns the new rationale + its timestamp;
  // the server enforces a 30s cooldown (429 with Retry-After) to prevent
  // Refresh-mashing.
  regenerateCoachNote: (dayId: string) =>
    typedRequest<{ planDayId: string; aiRationale: string; aiNoteUpdatedAt: string }>(
      "POST",
      `/api/v1/plans/days/${dayId}/coach-note/regenerate`,
      {},
    ),

  // Parse the plan day's free-text mainWorkout/accessory into structured
  // exercise_sets. Replaces the existing prescription. Used by the Parse
  // button in the workout detail dialog on planned entries.
  reparseDay: (dayId: string) =>
    typedRequest<{ exercises: unknown[]; saved: boolean; setCount: number }>(
      "POST",
      `/api/v1/plans/days/${dayId}/reparse`,
      {},
    ),

  reparseDayFromImage: (dayId: string, payload: ParseFromImagePayload) =>
    typedRequest<{ exercises: unknown[]; saved: boolean; setCount: number }>(
      "POST",
      `/api/v1/plans/days/${dayId}/reparse-from-image`,
      payload,
      IMAGE_REPARSE_REQUEST_OPTIONS,
    ),
} as const;
