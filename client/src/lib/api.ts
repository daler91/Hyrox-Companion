import { apiRequest } from "./queryClient";
import type {
  InsertWorkoutLog,
  UpdateWorkoutLog,
  WorkoutLog,
  TrainingPlan,
  PlanDay,
  User,
  InsertCoachingMaterial,
  CoachingMaterial,
  ChatMessage,
  ParsedExercise,
  PersonalRecord,
  CustomExercise,
  InsertCustomExercise,
  TimelineEntry,
  ExerciseSet,
} from "@shared/schema";

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

// ---------------------------------------------------------------------------
// Shared response / request types not in @shared/schema
// ---------------------------------------------------------------------------

export interface RagInfo {
  source: "rag" | "legacy" | "none";
  chunkCount: number;
  chunks?: string[];
  materialCount?: number;
}

export interface RagStatus {
  hasApiKey: boolean;
  totalMaterials: number;
  totalChunks: number;
  allEmbedded: boolean;
  materials: {
    id: string;
    title: string;
    type: string;
    contentLength: number;
    chunkCount: number;
    hasEmbeddings: boolean;
  }[];
  storedDimension: number | null;
  expectedDimension: number;
  dimensionMismatch: boolean;
  embeddingApi: { ok: boolean; dimension?: number; error?: string };
}

export interface Suggestion {
  workoutId: string;
  date: string;
  focus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

interface ReEmbedResponse {
  success: boolean;
  materialsProcessed: number;
  errors: string[];
}

interface ChatResponse {
  response: string;
  ragInfo?: RagInfo;
}

interface BatchReparseResponse {
  total: number;
  parsed: number;
  failed: number;
}

interface StravaSyncResponse {
  imported: number;
  skipped: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

async function typedRequest<TResponse>(
  method: string,
  url: string,
  data?: unknown,
): Promise<TResponse> {
  const args: [string, string, ...unknown[]] = [method, url];
  if (data !== undefined) args.push(data);
  const res = await apiRequest(...args);
  return res.json() as Promise<TResponse>;
}

function rawRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const args: [string, string, ...unknown[]] = [method, url];
  if (data !== undefined) args.push(data);
  return apiRequest(...args);
}

// ---------------------------------------------------------------------------
// Typed API client
// ---------------------------------------------------------------------------

export const api = {
  // -- Auth ----------------------------------------------------------------
  auth: {
    getUser: () => typedRequest<User>("GET", "/api/v1/auth/user"),
  },

  // -- Workouts ------------------------------------------------------------
  workouts: {
    create: (data: Omit<InsertWorkoutLog, "userId"> & { title?: string; exercises?: ParsedExercise[] }) =>
      typedRequest<{ message: string; workout: WorkoutLog }>("POST", "/api/v1/workouts", data),

    list: (params?: { limit?: number; offset?: number }) => {
      const qs = params
        ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
        : "";
      return typedRequest<WorkoutLog[]>("GET", `/api/v1/workouts${qs}`);
    },

    get: (id: string) => typedRequest<WorkoutLog & { exerciseSets?: ExerciseSet[] }>("GET", `/api/v1/workouts/${id}`),

    update: (id: string, data: UpdateWorkoutLog & { exercises?: ParsedExercise[] }) =>
      typedRequest<WorkoutLog>("PATCH", `/api/v1/workouts/${id}`, data),

    delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/workouts/${id}`),

    getUnstructured: () => typedRequest<WorkoutLog[]>("GET", "/api/v1/workouts/unstructured"),

    reparse: (id: string) => typedRequest<WorkoutLog>("POST", `/api/v1/workouts/${id}/reparse`),

    batchReparse: () => typedRequest<BatchReparseResponse>("POST", "/api/v1/workouts/batch-reparse"),
  },

  // -- Plans ---------------------------------------------------------------
  plans: {
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
  },

  // -- Chat ----------------------------------------------------------------
  chat: {
    sendStream: (data: { message: string; history?: Array<{ role: string; content: string }> }) =>
      rawRequest("POST", "/api/v1/chat/stream", data),

    send: (data: { message: string; history?: Array<{ role: string; content: string }> }) =>
      typedRequest<ChatResponse>("POST", "/api/v1/chat", data),

    saveMessage: (msg: { role: string; content: string }) =>
      typedRequest<ChatMessage>("POST", "/api/v1/chat/message", msg),

    clearHistory: () => typedRequest<{ success: boolean }>("DELETE", "/api/v1/chat/history"),
  },

  // -- Coaching ------------------------------------------------------------
  coaching: {
    list: () => typedRequest<CoachingMaterial[]>("GET", "/api/v1/coaching-materials"),

    create: (data: { title: string; content: string; type: "principles" | "document" }) =>
      typedRequest<CoachingMaterial>("POST", "/api/v1/coaching-materials", data),

    update: (id: string, data: Partial<InsertCoachingMaterial>) =>
      typedRequest<CoachingMaterial>("PATCH", `/api/v1/coaching-materials/${id}`, data),

    delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/coaching-materials/${id}`),

    getRagStatus: () => typedRequest<RagStatus>("GET", "/api/v1/coaching-materials/rag-status"),

    reEmbed: () => typedRequest<ReEmbedResponse>("POST", "/api/v1/coaching-materials/re-embed"),
  },

  // -- Preferences ---------------------------------------------------------
  preferences: {
    get: () => typedRequest<{ weightUnit: string; distanceUnit: string; weeklyGoal: number; emailNotifications: boolean; aiCoachEnabled: boolean }>("GET", "/api/v1/preferences"),

    update: (data: { weightUnit?: string; distanceUnit?: string; weeklyGoal?: number; emailNotifications?: boolean; aiCoachEnabled?: boolean }) =>
      typedRequest<User>("PATCH", "/api/v1/preferences", data),
  },

  // -- Exercises -----------------------------------------------------------
  exercises: {
    parse: (text: string) =>
      typedRequest<ParsedExercise[]>("POST", "/api/v1/parse-exercises", { text }),

    getHistory: (exerciseName: string) =>
      typedRequest<ExerciseSet[]>("GET", `/api/v1/exercises/${exerciseName}/history`),

    listCustom: () => typedRequest<CustomExercise[]>("GET", "/api/v1/custom-exercises"),

    createCustom: (data: InsertCustomExercise) =>
      typedRequest<CustomExercise>("POST", "/api/v1/custom-exercises", data),
  },

  // -- Timeline ------------------------------------------------------------
  timeline: {
    get: (planId?: string | null) => {
      const url = planId ? `/api/v1/timeline?planId=${planId}` : "/api/v1/timeline";
      return typedRequest<TimelineEntry[]>("GET", url);
    },

    getSuggestions: () =>
      typedRequest<{ suggestions: Suggestion[]; ragInfo?: RagInfo }>("POST", "/api/v1/timeline/ai-suggestions", {}),
  },

  // -- Analytics -----------------------------------------------------------
  analytics: {
    getPersonalRecords: () => typedRequest<Record<string, PersonalRecord>>("GET", "/api/v1/personal-records"),

    getExerciseAnalytics: () => typedRequest<unknown>("GET", "/api/v1/exercise-analytics"),
  },

  // -- Strava --------------------------------------------------------------
  strava: {
    auth: () => typedRequest<{ authUrl: string }>("GET", "/api/v1/strava/auth"),

    disconnect: () => rawRequest("DELETE", "/api/v1/strava/disconnect").then(() => undefined),

    sync: () => typedRequest<StravaSyncResponse>("POST", "/api/v1/strava/sync"),
  },

  // -- Email ---------------------------------------------------------------
  email: {
    check: () => typedRequest<{ success: boolean }>("POST", "/api/v1/emails/check"),
  },
} as const;
