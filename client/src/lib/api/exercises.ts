import type {
  AllowedImageMimeType,
  CustomExercise,
  ExerciseSet,
  InsertCustomExercise,
  ParsedExercise,
  StructureBlockInput,
} from "@shared/schema";

import { typedRequest } from "./client";

/** A logged set plus its parent workout's date — what the history endpoint has
 *  always returned, though the declared type here used to say otherwise. */
export type ExerciseSetWithDate = ExerciseSet & {
  date: string;
  /** Minutes from local midnight of the parent log — separates two sessions
   *  logged on the same day (audit M13). Null when the log captured no time. */
  timeOfDayMin?: number | null;
};

export interface ParseFromImagePayload {
  readonly imageBase64: string;
  readonly mimeType: AllowedImageMimeType;
}

export interface ParseWorkoutStructureResponse {
  readonly exercises: ParsedExercise[];
  readonly structureBlocks: StructureBlockInput[];
  readonly warnings: string[];
  readonly confidence?: {
    exerciseMapping?: number | null;
    structureQuality?: number | null;
  } | null;
}

export const exercises = {
  parse: (text: string, options?: { signal?: AbortSignal }) =>
    typedRequest<ParsedExercise[]>("POST", "/api/v1/parse-exercises", { text }, options),

  parseStructured: (text: string, options?: { signal?: AbortSignal }) =>
    typedRequest<ParseWorkoutStructureResponse>(
      "POST",
      "/api/v1/parse-workout-structure",
      { text },
      options,
    ),

  parseFromImage: (payload: ParseFromImagePayload, options?: { signal?: AbortSignal }) =>
    typedRequest<ParsedExercise[]>("POST", "/api/v1/parse-exercises-from-image", payload, options),

  parseStructuredFromImage: (payload: ParseFromImagePayload, options?: { signal?: AbortSignal }) =>
    typedRequest<ParseWorkoutStructureResponse>(
      "POST",
      "/api/v1/parse-workout-structure-from-image",
      payload,
      options,
    ),

  /** Past logged sets of one exercise, newest session first. `sessions` bounds
   *  distinct dates, not rows, so a session's sets never come back half. */
  getHistory: (exerciseName: string, options?: { sessions?: number }) =>
    typedRequest<ExerciseSetWithDate[]>(
      "GET",
      `/api/v1/exercises/${encodeURIComponent(exerciseName)}/history${
        options?.sessions ? `?sessions=${options.sessions}` : ""
      }`,
    ),

  listCustom: () => typedRequest<CustomExercise[]>("GET", "/api/v1/custom-exercises"),

  createCustom: (data: InsertCustomExercise) =>
    typedRequest<CustomExercise>("POST", "/api/v1/custom-exercises", data),
} as const;
