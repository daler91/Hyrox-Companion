export type { AnalyticsExportFormat, RacePredictionView, Suggestion } from "./analytics";
export { analytics, timeline } from "./analytics";
export type { RagInfo, RagStatus } from "./coaching";
export { chat, coaching } from "./coaching";
export type { ReparseResponse } from "./constants";
export { IMAGE_REPARSE_REQUEST_OPTIONS, IMAGE_REPARSE_TIMEOUT_MS, isTimeoutLikeApiError } from "./constants";
export type { ParseFromImagePayload, ParseWorkoutStructureResponse } from "./exercises";
export { exercises } from "./exercises";
export type { MafTagResponse, MafTestMetricsInput, MafTestMutationPayload, MafTestResult, MafTestsListResponse, MafWorkoutAnalysis } from "./mafTests";
export { mafTests } from "./mafTests";
export { nutrition } from "./nutrition";
export type { PlanDayReparseTextPayload } from "./plans";
export { plans } from "./plans";
export { timelineAnnotations } from "./timelineAnnotations";
export type { GarminStatus, GarminSyncResponse, StravaStatus, StravaSyncResponse, UserPreferences } from "./user";
export { auth, email, garmin, preferences, strava } from "./user";
export type { BatchReparseResponse, BulkDeleteWorkoutsPayload, BulkDeleteWorkoutsResponse, ReparseWorkoutTextPayload, WorkoutHistoryStats, WorkoutReferenceTextPayload } from "./workouts";
export { workouts } from "./workouts";

// ---------------------------------------------------------------------------
// Re-assembled api object (preserves existing import shape)
// ---------------------------------------------------------------------------
import { analytics, timeline } from "./analytics";
import { chat, coaching } from "./coaching";
import { exercises } from "./exercises";
import { mafTests } from "./mafTests";
import { nutrition } from "./nutrition";
import { plans } from "./plans";
import { timelineAnnotations } from "./timelineAnnotations";
import { auth, email, garmin, preferences, strava } from "./user";
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
  mafTests,
  nutrition,
} as const;

// ---------------------------------------------------------------------------
// Query key constants
// ---------------------------------------------------------------------------
export const QUERY_KEYS = {
  authUser: ["/api/v1/auth/user"] as const,
  preferences: ["/api/v1/preferences"] as const,
  plans: ["/api/v1/plans"] as const,
  plan: (id: string) => ["/api/v1/plans", id] as const,
  timeline: ["/api/v1/timeline"] as const,
  timelineAnnotations: ["/api/v1/timeline-annotations"] as const,
  workouts: ["/api/v1/workouts"] as const,
  workout: (id: string) => ["/api/v1/workouts", id] as const,
  workoutHistory: (id: string) => ["/api/v1/workouts", id, "history"] as const,
  planDayExercises: (dayId: string) => ["/api/v1/plans/days", dayId, "sets"] as const,
  personalRecords: ["/api/v1/personal-records"] as const,
  exerciseAnalytics: ["/api/v1/exercise-analytics"] as const,
  trainingOverview: ["/api/v1/training-overview"] as const,
  racePrediction: ["/api/v1/race-prediction"] as const,
  coachInsights: ["/api/v1/coach-insights"] as const,
  chatHistory: ["/api/v1/chat/history"] as const,
  coachingMaterials: ["/api/v1/coaching-materials"] as const,
  ragStatus: ["/api/v1/coaching-materials/rag-status"] as const,
  customExercises: ["/api/v1/custom-exercises"] as const,
  stravaStatus: ["/api/v1/strava/status"] as const,
  garminStatus: ["/api/v1/garmin/status"] as const,
  mafTests: ["/api/v1/maf-tests"] as const,
  nutritionDay: (date: string) => ["/api/v1/nutrition/summary", date] as const,
  nutritionRecent: ["/api/v1/nutrition/foods/recent"] as const,
  nutritionFavorites: ["/api/v1/nutrition/favorites"] as const,
  nutritionSearch: (q: string) => ["/api/v1/nutrition/foods/search", q] as const,
  nutritionCustomFoods: ["/api/v1/nutrition/foods/custom"] as const,
  nutritionRecipes: ["/api/v1/nutrition/recipes"] as const,
  nutritionRecipe: (id: string) => ["/api/v1/nutrition/recipes", id] as const,
  nutritionFood: (id: string) => ["/api/v1/nutrition/foods", id] as const,
  nutritionSessionFuelling: (workoutId: string) =>
    ["/api/v1/nutrition/session-fuelling", workoutId] as const,
  nutritionBlock: (from: string, to: string) =>
    ["/api/v1/nutrition/block", from, to] as const,
  nutritionTargets: ["/api/v1/nutrition/targets"] as const,
} as const;

export type { AddExerciseSetPayload, PatchExerciseSetPayload } from "./exerciseSetMutations";
