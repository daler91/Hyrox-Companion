import { exercisesPayloadSchema, insertCustomExerciseSchema, insertWorkoutLogSchema, updateWorkoutLogSchema } from "@shared/schema";
import { z } from "zod";

export const createWorkoutRouteSchema = insertWorkoutLogSchema.extend({ exercises: exercisesPayloadSchema.optional() });
export const updateWorkoutRouteSchema = updateWorkoutLogSchema.extend({ exercises: exercisesPayloadSchema.optional() });
export const reparseWorkoutParamsSchema = z.object({ id: z.string().min(1) });
export const reparseWorkoutRouteSchema = z.object({ prescribedMainWorkout: z.string().nullable().optional(), prescribedAccessory: z.string().nullable().optional() }).strict();
export const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });
