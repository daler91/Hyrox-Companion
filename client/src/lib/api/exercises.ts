import type {
  CustomExercise,
  ExerciseSet,
  InsertCustomExercise,
  ParsedExercise,
} from "@shared/schema";

import { typedRequest } from "./client";

export const exercises = {
  parse: (text: string) =>
    typedRequest<ParsedExercise[]>("POST", "/api/v1/parse-exercises", { text }),

  getHistory: (exerciseName: string) =>
    typedRequest<ExerciseSet[]>("GET", `/api/v1/exercises/${exerciseName}/history`),

  listCustom: () => typedRequest<CustomExercise[]>("GET", "/api/v1/custom-exercises"),

  createCustom: (data: InsertCustomExercise) =>
    typedRequest<CustomExercise>("POST", "/api/v1/custom-exercises", data),
} as const;
