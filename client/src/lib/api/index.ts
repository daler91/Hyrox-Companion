export type { Suggestion } from "./analytics";
export { analytics, timeline } from "./analytics";
export type { RagInfo, RagStatus } from "./coaching";
export { chat, coaching } from "./coaching";
export { exercises } from "./exercises";
export { plans } from "./plans";
export type { StravaSyncResponse } from "./user";
export { auth, email,preferences, strava } from "./user";
export type { BatchReparseResponse } from "./workouts";
export { workouts } from "./workouts";

// ---------------------------------------------------------------------------
// Re-assembled api object (preserves existing import shape)
// ---------------------------------------------------------------------------
import { analytics, timeline } from "./analytics";
import { chat, coaching } from "./coaching";
import { exercises } from "./exercises";
import { plans } from "./plans";
import { auth, email,preferences, strava } from "./user";
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
  analytics,
  strava,
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
  workouts: ["/api/v1/workouts"] as const,
  personalRecords: ["/api/v1/personal-records"] as const,
  exerciseAnalytics: ["/api/v1/exercise-analytics"] as const,
  trainingOverview: ["/api/v1/training-overview"] as const,
  chatHistory: ["/api/v1/chat/history"] as const,
  coachingMaterials: ["/api/v1/coaching-materials"] as const,
  ragStatus: ["/api/v1/coaching-materials/rag-status"] as const,
  customExercises: ["/api/v1/custom-exercises"] as const,
  stravaStatus: ["/api/v1/strava/status"] as const,
} as const;
