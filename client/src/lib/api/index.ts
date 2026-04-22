export type { Suggestion } from "./analytics";
export { analytics, timeline } from "./analytics";
export type { RagInfo, RagStatus } from "./coaching";
export { chat, coaching } from "./coaching";
export { exercises } from "./exercises";
export type { ParseFromImagePayload } from "./exercises";
export { plans } from "./plans";
export { timelineAnnotations } from "./timelineAnnotations";
export type { GarminStatus, GarminSyncResponse,StravaSyncResponse } from "./user";
export { auth, email,garmin, preferences, strava } from "./user";
export type {
  AddExerciseSetPayload,
  BatchReparseResponse,
  PatchExerciseSetPayload,
  ReparseResponse,
  WorkoutHistoryStats,
} from "./workouts";
export { workouts } from "./workouts";

// ---------------------------------------------------------------------------
// Re-assembled api object (preserves existing import shape)
// ---------------------------------------------------------------------------
import { analytics, timeline } from "./analytics";
import { chat, coaching } from "./coaching";
import { exercises } from "./exercises";
import { plans } from "./plans";
import { timelineAnnotations } from "./timelineAnnotations";
import { auth, email,garmin, preferences, strava } from "./user";
import { workouts } from "./workouts";

export const api = {
  auth,
  workouts,
  plans,
  chat,
  coaching,
  preferences,
  exercises,
  timeline,
  timelineAnnotations,
  analytics,
  strava,
  garmin,
  email,
} as const;

// ---------------------------------------------------------------------------
// Query key constants
// ---------------------------------------------------------------------------
export const QUERY_KEYS = {
  authUser: ["/api/v1/auth/user"] as const,
  preferences: ["/api/v1/preferences"] as const,
  plans: ["/api/v1/plans"] as const,
  timeline: ["/api/v1/timeline"] as const,
  timelineAnnotations: ["/api/v1/timeline-annotations"] as const,
  workouts: ["/api/v1/workouts"] as const,
  workout: (id: string) => ["/api/v1/workouts", id] as const,
  workoutHistory: (id: string) => ["/api/v1/workouts", id, "history"] as const,
  planDayExercises: (dayId: string) => ["/api/v1/plans/days", dayId, "sets"] as const,
  personalRecords: ["/api/v1/personal-records"] as const,
  exerciseAnalytics: ["/api/v1/exercise-analytics"] as const,
  trainingOverview: ["/api/v1/training-overview"] as const,
  chatHistory: ["/api/v1/chat/history"] as const,
  coachingMaterials: ["/api/v1/coaching-materials"] as const,
  ragStatus: ["/api/v1/coaching-materials/rag-status"] as const,
  customExercises: ["/api/v1/custom-exercises"] as const,
  stravaStatus: ["/api/v1/strava/status"] as const,
  garminStatus: ["/api/v1/garmin/status"] as const,
} as const;
