import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// MUST extend Zod before importing any schemas that use it
extendZodWithOpenApi(z);

import {
  insertWorkoutLogSchema,
  insertExerciseSetSchema,
  insertPlanDaySchema,
  updateUserPreferencesSchema,
  exerciseSetSchema,
} from "./schema";

export const registry = new OpenAPIRegistry();

// Register base schemas as reusable components
export const InsertWorkoutLogSchema = registry.register(
  "InsertWorkoutLog",
  insertWorkoutLogSchema.openapi({
    title: "InsertWorkoutLog",
    description: "Payload for creating a new workout log",
  })
);

export const ExerciseSetSchema = registry.register(
  "ExerciseSet",
  exerciseSetSchema.openapi({
    title: "ExerciseSet",
    description: "A single set of an exercise in a workout",
  })
);

export const InsertExerciseSetSchema = registry.register(
  "InsertExerciseSet",
  insertExerciseSetSchema.openapi({
    title: "InsertExerciseSet",
    description: "Payload for creating a new exercise set",
  })
);

export const UpdateUserPreferencesSchema = registry.register(
  "UpdateUserPreferences",
  updateUserPreferencesSchema.openapi({
    title: "UpdateUserPreferences",
    description: "User profile preferences",
  })
);

export const InsertPlanDaySchema = registry.register(
  "InsertPlanDay",
  insertPlanDaySchema.openapi({
    title: "InsertPlanDay",
    description: "Payload for creating a planned workout day",
  })
);

// Define Example Routes (Path Items)
registry.registerPath({
  method: "post",
  path: "/api/workouts",
  tags: ["Workouts"],
  summary: "Create a new workout log",
  description: "Creates a new workout log with optional exercise sets.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: InsertWorkoutLogSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Workout log created successfully",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string().openapi({ example: "Workout log created successfully" }),
            workout: InsertWorkoutLogSchema,
          }),
        },
      },
    },
    400: {
      description: "Invalid request payload",
    },
    401: {
      description: "Unauthorized",
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/workouts",
  tags: ["Workouts"],
  summary: "Get all workout logs",
  description: "Retrieves a list of all workout logs for the authenticated user.",
  responses: {
    200: {
      description: "A list of workout logs",
      content: {
        "application/json": {
          schema: z.array(InsertWorkoutLogSchema),
        },
      },
    },
    401: {
      description: "Unauthorized",
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/preferences",
  tags: ["Preferences"],
  summary: "Update user preferences",
  description: "Updates the authenticated user's profile preferences.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdateUserPreferencesSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Preferences updated successfully",
      content: {
        "application/json": {
          schema: UpdateUserPreferencesSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
    },
  },
});

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Workout API",
      description: "API for managing workouts, exercises, and training plans.",
    },
    servers: [{ url: "/" }],
  });
}
