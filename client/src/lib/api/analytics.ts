import type { OverviewChartKey, PersonalRecord, RacePredictionResponse, TimelineEntry, TrainingOverview } from "@shared/schema";

import { rawRequest, typedRequest } from "./client";
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

export interface ApplySuggestionPayload extends Suggestion {
  aiSource?: RagInfo["source"] | null;
}

export type ApplySuggestionResult =
  | { applied: true; structured: boolean }
  | {
      applied: false;
      structured: false;
      reason: "ai_budget_exceeded" | "ai_disabled" | "structured_parse_failed";
      message: string;
    };

export type AnalyticsExportFormat = "csv" | "json";

/**
 * Race prediction as returned to the client. Extends the shared response with a
 * `stale` flag the server sets when a workout was logged after the stored
 * prediction was generated.
 */
export type RacePredictionView = RacePredictionResponse & { stale?: boolean };

/**
 * Overview AI chart analysis as returned to the client. `sections` is null when
 * the athlete has never generated it — the GET surfaces the stored result (or
 * this empty sentinel) without spending AI. `stale` flags that a workout was
 * logged after the analysis was generated.
 */
export interface OverviewAnalysisResponse {
  sections: Partial<Record<OverviewChartKey, string>> | null;
  generatedAt?: string;
  stale?: boolean;
}

export const analytics = {
  getPersonalRecords: (dateParams?: string) =>
    typedRequest<Record<string, PersonalRecord>>("GET", `/api/v1/personal-records${dateParams || ""}`),

  getExerciseAnalytics: (dateParams?: string) =>
    typedRequest<Record<string, unknown>>("GET", `/api/v1/exercise-analytics${dateParams || ""}`),

  getTrainingOverview: (dateParams?: string) =>
    typedRequest<TrainingOverview>("GET", `/api/v1/training-overview${dateParams ?? ""}`),

  // Fetch the LAST stored Overview chart analysis (no AI spend) so each chart's
  // explanation paints instantly on open. Returns `{ sections: null }` when the
  // athlete has never generated it.
  getOverviewAnalysis: () =>
    typedRequest<OverviewAnalysisResponse>("GET", "/api/v1/overview-analysis"),

  // Regenerate (and persist) the per-chart analysis. Builds the training
  // overview and uses a reasoning AI model server-side; matches the
  // race-prediction / suggestions budget so it doesn't time out.
  regenerateOverviewAnalysis: () =>
    typedRequest<OverviewAnalysisResponse>("POST", "/api/v1/overview-analysis", {}, {
      timeoutMs: 90_000,
    }),

  // Without `refresh`, returns the stored prediction instantly (no AI spend).
  // With `refresh: true` (manual refresh button), forces a fresh regeneration.
  getRacePrediction: (options?: { refresh?: boolean }) =>
    typedRequest<RacePredictionView>(
      "GET",
      `/api/v1/race-prediction${options?.refresh ? "?refresh=1" : ""}`,
      undefined,
      {
        // May invoke a reasoning AI model server-side; allow well past the
        // default 15s timeout (matches the suggestions pattern).
        timeoutMs: 90_000,
      },
    ),

  exportData: (format: AnalyticsExportFormat) =>
    rawRequest("GET", `/api/v1/export?format=${format}`),
} as const;

export const timeline = {
  get: (planId?: string | null) => {
    const url = planId ? `/api/v1/timeline?planId=${planId}` : "/api/v1/timeline";
    return typedRequest<TimelineEntry[]>("GET", url);
  },

  getSuggestions: () =>
    typedRequest<{ suggestions: Suggestion[]; ragInfo?: RagInfo; message?: string }>("POST", "/api/v1/timeline/ai-suggestions", {}, {
      // Suggestions build full training + RAG context and use a reasoning
      // AI model; responses often exceed the default 15s timeout.
      timeoutMs: 90_000,
    }),

  applySuggestion: (payload: ApplySuggestionPayload) =>
    typedRequest<ApplySuggestionResult>(
      "POST",
      "/api/v1/timeline/ai-suggestions/apply",
      payload,
      {
        // Table-backed suggestions may need a parse pass before rows are written.
        timeoutMs: 90_000,
      },
    ),
} as const;
