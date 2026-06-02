import type { mafTestResults, mafWorkoutAnalysis } from "@shared/schema";

import { typedRequest } from "./client";

// Row shapes inferred from the Drizzle tables (type-only — erased at build, so
// no drizzle runtime is pulled into the client bundle). These mirror the server
// storage types in server/storage/mafTests.ts.
export type MafTestResult = typeof mafTestResults.$inferSelect;
export type MafWorkoutAnalysis = typeof mafWorkoutAnalysis.$inferSelect;

export interface MafTagResponse {
  testResult: MafTestResult;
  analysis: MafWorkoutAnalysis | null;
}

export interface MafTestsListResponse {
  tests: MafTestResult[];
  analysis: MafWorkoutAnalysis[];
}

/**
 * Manually-entered metrics in canonical units (meters, seconds, bpm). A field
 * set to `null` clears the value; an omitted field keeps the auto-pulled (tag)
 * or previously stored (edit) value. Mirrors the server `metrics` subschema.
 */
export interface MafTestMetricsInput {
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}

export interface MafTestMutationPayload {
  protocolType?: string;
  notes?: string;
  metrics?: MafTestMetricsInput;
}

export const mafTests = {
  // Tag an already-logged workout as a MAF test, optionally with manually-entered
  // metrics. Idempotent server-side: a re-tag returns the existing record (HTTP
  // 200) rather than duplicating it — later corrections go through `updateTest`.
  tagWorkout: (workoutId: string, payload?: MafTestMutationPayload) =>
    payload === undefined
      ? typedRequest<MafTagResponse>("POST", `/api/v1/workouts/${workoutId}/maf-test`)
      : typedRequest<MafTagResponse>("POST", `/api/v1/workouts/${workoutId}/maf-test`, payload),

  // Edit an already-tagged workout's MAF test: applies manual metric corrections
  // and recomputes its compliance analysis. 404s when the workout isn't tagged.
  updateTest: (workoutId: string, payload: MafTestMutationPayload) =>
    typedRequest<MafTagResponse>("PATCH", `/api/v1/workouts/${workoutId}/maf-test`, payload),

  // Untag a workout: removes its MAF test (and compliance analysis). The inverse
  // of `tagWorkout`, for undoing an accidental tag.
  untagWorkout: (workoutId: string) =>
    typedRequest<{ success: true }>("DELETE", `/api/v1/workouts/${workoutId}/maf-test`),

  // MAF test history + per-test compliance analysis for the trend view.
  list: () => typedRequest<MafTestsListResponse>("GET", "/api/v1/maf-tests"),
} as const;
