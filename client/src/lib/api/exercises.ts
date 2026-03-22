import { typedRequest } from "./client";
import type {
  ParsedExercise,
  ExerciseSet,
  CustomExercise,
  InsertCustomExercise,
} from "@shared/schema";

export const exercises = {
  parse: (text: string) =>
    typedRequest<ParsedExercise[]>("POST", "/api/v1/parse-exercises", { text }),

  getHistory: (exerciseName: string) =>
    typedRequest<ExerciseSet[]>("GET", `/api/v1/exercises/${exerciseName}/history`),

  listCustom: () => typedRequest<CustomExercise[]>("GET", "/api/v1/custom-exercises"),

  createCustom: (data: InsertCustomExercise) =>
    typedRequest<CustomExercise>("POST", "/api/v1/custom-exercises", data),
} as const;
