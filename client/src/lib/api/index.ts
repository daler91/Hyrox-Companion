export { workouts } from "./workouts";
export type { BatchReparseResponse } from "./workouts";

export { plans } from "./plans";

export { chat, coaching } from "./coaching";
export type { RagInfo, RagStatus } from "./coaching";

export { analytics, timeline } from "./analytics";
export type { Suggestion } from "./analytics";

export { auth, preferences, strava, email } from "./user";
export type { StravaSyncResponse } from "./user";

export { exercises } from "./exercises";

// ---------------------------------------------------------------------------
// Re-assembled api object (preserves existing import shape)
// ---------------------------------------------------------------------------
import { workouts } from "./workouts";
import { plans } from "./plans";
import { chat, coaching } from "./coaching";
import { analytics, timeline } from "./analytics";
import { auth, preferences, strava, email } from "./user";
import { exercises } from "./exercises";

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
  chatHistory: ["/api/v1/chat/history"] as const,
  coachingMaterials: ["/api/v1/coaching-materials"] as const,
  ragStatus: ["/api/v1/coaching-materials/rag-status"] as const,
  customExercises: ["/api/v1/custom-exercises"] as const,
  stravaStatus: ["/api/v1/strava/status"] as const,
} as const;
