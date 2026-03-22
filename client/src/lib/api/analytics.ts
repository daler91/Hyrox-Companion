import { typedRequest } from "./client";
import type { PersonalRecord, TimelineEntry } from "@shared/schema";
import type { RagInfo } from "./coaching";

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

export const analytics = {
  getPersonalRecords: (dateParams?: string) =>
    typedRequest<Record<string, PersonalRecord>>("GET", `/api/v1/personal-records${dateParams || ""}`),

  getExerciseAnalytics: (dateParams?: string) =>
    typedRequest<unknown>("GET", `/api/v1/exercise-analytics${dateParams || ""}`),
} as const;

export const timeline = {
  get: (planId?: string | null) => {
    const url = planId ? `/api/v1/timeline?planId=${planId}` : "/api/v1/timeline";
    return typedRequest<TimelineEntry[]>("GET", url);
  },

  getSuggestions: () =>
    typedRequest<{ suggestions: Suggestion[]; ragInfo?: RagInfo }>("POST", "/api/v1/timeline/ai-suggestions", {}),
} as const;
