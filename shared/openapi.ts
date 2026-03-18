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
  exercisesPayloadSchema,
  updateWorkoutLogSchema,
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

// Create a combined schema for creating a workout that includes the optional exercises payload
export const CreateWorkoutRequestSchema = registry.register(
  "CreateWorkoutRequest",
  z.intersection(
    insertWorkoutLogSchema,
    z.object({
      exercises: exercisesPayloadSchema.optional(),
    })
  ).openapi({
    title: "CreateWorkoutRequest",
    description: "Payload for creating a new workout log along with optional exercise sets",
  })
);

// Create a combined schema for updating a workout that includes the optional exercises payload
export const UpdateWorkoutRequestSchema = registry.register(
  "UpdateWorkoutRequest",
  z.intersection(
    updateWorkoutLogSchema,
    z.object({
      exercises: exercisesPayloadSchema.optional(),
    })
  ).openapi({
    title: "UpdateWorkoutRequest",
    description: "Payload for updating a workout log along with optional exercise sets",
  })
);

export const WorkoutIdParam = registry.registerParameter(
  "WorkoutId",
  z.string().openapi({
    param: {
      name: "id",
      in: "path",
    },
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "The UUID of the workout log",
  })
);

// Register Security Scheme
const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Enter your Clerk JWT token in the format: Bearer <token>",
});

const security = [{ [bearerAuth.name]: [] }];

// Define Example Routes (Path Items)
registry.registerPath({
  method: "post",
  path: "/api/v1/workouts",
  tags: ["Workouts"],
  summary: "Create a new workout log",
  description: "Creates a new workout log with optional detailed exercise sets (the `exercises` array).",
  security,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateWorkoutRequestSchema,
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
  path: "/api/v1/workouts",
  tags: ["Workouts"],
  summary: "Get all workout logs",
  description: "Retrieves a list of all workout logs for the authenticated user.",
  security,
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
  method: "get",
  path: "/api/v1/workouts/{id}",
  tags: ["Workouts"],
  summary: "Get a specific workout log",
  description: "Retrieves a specific workout log by its ID for the authenticated user.",
  security,
  request: {
    params: z.object({
      id: WorkoutIdParam,
    }),
  },
  responses: {
    200: {
      description: "The requested workout log",
      content: {
        "application/json": {
          schema: InsertWorkoutLogSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
    },
    404: {
      description: "Workout not found",
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/workouts/{id}",
  tags: ["Workouts"],
  summary: "Update a specific workout log",
  description: "Updates an existing workout log by its ID. You can optionally include an `exercises` array to replace the existing exercise sets.",
  security,
  request: {
    params: z.object({
      id: WorkoutIdParam,
    }),
    body: {
      content: {
        "application/json": {
          schema: UpdateWorkoutRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Workout log updated successfully",
      content: {
        "application/json": {
          schema: InsertWorkoutLogSchema,
        },
      },
    },
    400: {
      description: "Invalid request payload",
    },
    401: {
      description: "Unauthorized",
    },
    404: {
      description: "Workout not found",
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/workouts/{id}",
  tags: ["Workouts"],
  summary: "Delete a specific workout log",
  description: "Deletes an existing workout log by its ID for the authenticated user.",
  security,
  request: {
    params: z.object({
      id: WorkoutIdParam,
    }),
  },
  responses: {
    200: {
      description: "Workout log deleted successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().openapi({ example: true }),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
    },
    404: {
      description: "Workout not found",
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/preferences",
  tags: ["Preferences"],
  summary: "Update user preferences",
  description: "Updates the authenticated user's profile preferences.",
  security,
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
      title: "Hyrox-Companion Workout API",
      description: `
API for managing workouts, exercises, and training plans.

### Authentication
This API is protected using JWT Bearer authentication provided by Clerk.
To authenticate your requests:
1. Obtain a valid JWT session token for your user from Clerk. If you are building a frontend integration, you can use Clerk's \`getToken()\` method from their SDKs.
2. Include the token in the \`Authorization\` header of your HTTP requests as follows:
   \`Authorization: Bearer <your-clerk-jwt-token>\`

Click the **Authorize** button below to enter your JWT token for use within this Swagger UI.
      `.trim(),
    },
    servers: [{ url: "/" }],
  });
}
