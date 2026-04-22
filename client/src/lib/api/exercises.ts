import type {
  AllowedImageMimeType,
  CustomExercise,
  ExerciseSet,
  InsertCustomExercise,
  ParsedExercise,
} from "@shared/schema";

import { typedRequest } from "./client";

export interface ParseFromImagePayload {
  readonly imageBase64: string;
  readonly mimeType: AllowedImageMimeType;
}

export const exercises = {
  parse: (text: string, options?: { signal?: AbortSignal }) =>
    typedRequest<ParsedExercise[]>("POST", "/api/v1/parse-exercises", { text }, options),

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

  getHistory: (exerciseName: string) =>
    typedRequest<ExerciseSet[]>("GET", `/api/v1/exercises/${exerciseName}/history`),

  listCustom: () => typedRequest<CustomExercise[]>("GET", "/api/v1/custom-exercises"),

  createCustom: (data: InsertCustomExercise) =>
    typedRequest<CustomExercise>("POST", "/api/v1/custom-exercises", data),
} as const;
