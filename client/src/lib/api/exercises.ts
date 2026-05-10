import type {
  AllowedImageMimeType,
  CustomExercise,
  ExerciseSet,
  InsertCustomExercise,
  ParsedExercise,
  StructureBlockInput,
} from "@shared/schema";

import { typedRequest } from "./client";

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
    typedRequest<ParseWorkoutStructureResponse>("POST", "/api/v1/parse-workout-structure", { text }, options),

  parseFromImage: (
    payload: ParseFromImagePayload,
    options?: { signal?: AbortSignal },
  ) =>
    typedRequest<ParsedExercise[]>(
      "POST",
      "/api/v1/parse-exercises-from-image",
      payload,
      options,
    ),

  parseStructuredFromImage: (
    payload: ParseFromImagePayload,
    options?: { signal?: AbortSignal },
  ) =>
    typedRequest<ParseWorkoutStructureResponse>(
      "POST",
      "/api/v1/parse-workout-structure-from-image",
      payload,
      options,
    ),

  getHistory: (exerciseName: string) =>
    typedRequest<ExerciseSet[]>("GET", `/api/v1/exercises/${exerciseName}/history`),

  listCustom: () => typedRequest<CustomExercise[]>("GET", "/api/v1/custom-exercises"),

  createCustom: (data: InsertCustomExercise) =>
    typedRequest<CustomExercise>("POST", "/api/v1/custom-exercises", data),
} as const;
