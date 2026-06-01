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

export const mafTests = {
  // Tag an already-logged workout as a MAF test. Idempotent server-side: a
  // re-tag returns the existing record (HTTP 200) rather than duplicating it.
  tagWorkout: (workoutId: string, payload?: { protocolType?: string; notes?: string }) =>
    payload === undefined
      ? typedRequest<MafTagResponse>("POST", `/api/v1/workouts/${workoutId}/maf-test`)
      : typedRequest<MafTagResponse>("POST", `/api/v1/workouts/${workoutId}/maf-test`, payload),

  // Untag a workout: removes its MAF test (and compliance analysis). The inverse
  // of `tagWorkout`, for undoing an accidental tag.
  untagWorkout: (workoutId: string) =>
    typedRequest<{ success: true }>("DELETE", `/api/v1/workouts/${workoutId}/maf-test`),

  // MAF test history + per-test compliance analysis for the trend view.
  list: () => typedRequest<MafTestsListResponse>("GET", "/api/v1/maf-tests"),
} as const;
