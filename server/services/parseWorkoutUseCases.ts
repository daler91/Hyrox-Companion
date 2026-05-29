import type { updateWorkoutLogSchema } from "@shared/schema";
import type { z } from "zod";

import { storage } from "../storage";
import { incrementStructuredExerciseCounter } from "./structuredExerciseHealth";
import { batchReparseWorkouts, reparseWorkout, reparseWorkoutFromImage } from "./workoutService";

// Orchestration for the AI re-parse routes, extracted from
// server/routes/workouts/workoutsAi.routes.ts so the route handlers stay thin
// (validate-and-delegate) and match the workoutUseCases.ts pattern
// (CODEBASE_AUDIT.md §1, review A1).

type ReparseSuccess = NonNullable<Awaited<ReturnType<typeof reparseWorkout>>>;

/** Response body shared by both reparse endpoints (drops the service-internal `fallbackUsed`). */
export interface ReparseResponse {
  exercises: ReparseSuccess["exercises"];
  saved: true;
  setCount: number;
  rejectedCount: number;
  rejectionReasons: string[];
}

/**
 * Transport-agnostic outcomes the route maps to HTTP:
 *   not_found    → 404
 *   parse_failed → 422 PARSE_WRITE_THROUGH_REQUIRED (parse produced no rows)
 *   ok           → 200 with the response body
 */
export type ReparseOutcome =
  | { status: "not_found" }
  | { status: "parse_failed" }
  | { status: "ok"; response: ReparseResponse };

function toResponse(result: ReparseSuccess): ReparseResponse {
  return {
    exercises: result.exercises,
    saved: true,
    setCount: result.setCount,
    rejectedCount: result.rejectedCount,
    rejectionReasons: result.rejectionReasons,
  };
}

export interface ReparseWorkoutTextPayload {
  prescribedMainWorkout?: string | null;
  prescribedAccessory?: string | null;
}

/**
 * Re-parse a workout's prescribed text into structured exercise sets. Prescribed-
 * text overrides in the payload are persisted only when the parse succeeds, so a
 * failed reparse never mutates the stored prescription.
 */
export async function reparseWorkoutUseCase(input: {
  userId: string;
  workoutId: string;
  payload: ReparseWorkoutTextPayload;
}): Promise<ReparseOutcome> {
  const { userId, workoutId, payload } = input;
  const [workout, user] = await Promise.all([
    storage.workouts.getWorkoutLog(workoutId, userId),
    storage.users.getUser(userId),
  ]);
  if (!workout) return { status: "not_found" };

  const unitPreferences = { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" };
  const referencePatch: Partial<z.infer<typeof updateWorkoutLogSchema>> = {};
  const parseTarget: { id: string; mainWorkout?: string | null; accessory?: string | null } = {
    id: workout.id,
    mainWorkout: workout.prescribedMainWorkout ?? workout.mainWorkout,
    accessory: workout.prescribedAccessory ?? workout.accessory,
  };
  if (payload.prescribedMainWorkout !== undefined) {
    referencePatch.prescribedMainWorkout = payload.prescribedMainWorkout;
    parseTarget.mainWorkout = payload.prescribedMainWorkout;
  }
  if (payload.prescribedAccessory !== undefined) {
    referencePatch.prescribedAccessory = payload.prescribedAccessory;
    parseTarget.accessory = payload.prescribedAccessory;
  }

  void incrementStructuredExerciseCounter("workout_log", "voice", "parse_text_attempted").catch(() => undefined);
  const result = await reparseWorkout(parseTarget, unitPreferences);
  if (!result || result.setCount === 0) {
    void incrementStructuredExerciseCounter("workout_log", "voice", "parse_text_failed").catch(() => undefined);
    return { status: "parse_failed" };
  }
  if (Object.keys(referencePatch).length > 0) {
    await storage.workouts.updateWorkoutLog(workoutId, referencePatch, userId);
  }
  void incrementStructuredExerciseCounter("workout_log", "voice", "parse_text_succeeded").catch(() => undefined);
  return { status: "ok", response: toResponse(result) };
}

/** Re-parse a workout from an uploaded image into structured exercise sets. */
export async function reparseWorkoutFromImageUseCase(input: {
  userId: string;
  workoutId: string;
  image: Parameters<typeof reparseWorkoutFromImage>[1];
}): Promise<ReparseOutcome> {
  const { userId, workoutId, image } = input;
  const [workout, user, customExercises] = await Promise.all([
    storage.workouts.getWorkoutLog(workoutId, userId),
    storage.users.getUser(userId),
    storage.users.getCustomExercises(userId),
  ]);
  if (!workout) return { status: "not_found" };

  void incrementStructuredExerciseCounter("workout_log", "photo", "parse_photo_attempted").catch(() => undefined);
  const result = await reparseWorkoutFromImage(
    workout,
    image,
    { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" },
    userId,
    customExercises.map((exercise) => exercise.name),
  );
  if (!result || result.setCount === 0) {
    void incrementStructuredExerciseCounter("workout_log", "photo", "parse_photo_failed").catch(() => undefined);
    return { status: "parse_failed" };
  }
  void incrementStructuredExerciseCounter("workout_log", "photo", "parse_photo_succeeded").catch(() => undefined);
  return { status: "ok", response: toResponse(result) };
}

/** Re-parse every still-unstructured workout for a user. */
export async function batchReparseWorkoutsUseCase(input: {
  userId: string;
}): Promise<{ total: number; parsed: number; failed: number }> {
  return batchReparseWorkouts(input.userId);
}
