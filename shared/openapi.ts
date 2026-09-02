import { OpenApiGeneratorV3, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import {
  exerciseSetSchema,
  exercisesPayloadSchema,
  insertExerciseSetSchema,
  insertPlanDaySchema,
  insertWorkoutLogSchema,
  updateUserPreferencesSchema,
  updateWorkoutLogSchema,
  users,
  workoutLogs,
} from "./schema";
import { z } from "./schema/zod";

export const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Realistic Hyrox-specific examples for Swagger UI "Try it out"
// ---------------------------------------------------------------------------

// `time` on a set is MINUTES (see docs/adr-units.md), so these examples are
// fractional: a 42-second sled push is 0.7. They used to read 42 / 45 / 48 and
// 210 -- seconds values -- which advertised the wrong unit to every API consumer
// reading the docs, against a column the app reads as minutes (audit C7).
const EXAMPLE_EXERCISE_SLED_PUSH = {
  exerciseName: "Sled Push",
  category: "conditioning",
  numSets: 3,
  sets: [
    { setNumber: 1, distance: 50, time: 0.7, notes: "Smooth pace — 42s" },
    { setNumber: 2, distance: 50, time: 0.75 },
    { setNumber: 3, distance: 50, time: 0.8 },
  ],
};

const EXAMPLE_EXERCISE_BURPEE_BROAD_JUMPS = {
  exerciseName: "Burpee Broad Jumps",
  category: "functional",
  numSets: 2,
  reps: 10,
  sets: [
    { setNumber: 1, reps: 10, notes: "Full extension" },
    { setNumber: 2, reps: 10 },
  ],
};

const EXAMPLE_EXERCISE_ROWING = {
  exerciseName: "Rowing",
  category: "conditioning",
  numSets: 1,
  distance: 1000,
  time: 3.5,
  sets: [{ setNumber: 1, distance: 1000, time: 3.5 }],
};

const EXAMPLE_CREATE_WORKOUT = {
  date: "2026-03-29",
  focus: "conditioning",
  mainWorkout: "3 rounds: Sled Push 50m, Burpee Broad Jumps x10, 1km Row",
  accessory: "Core circuit: 3x20 sit-ups, 3x30s plank",
  notes: "Hyrox simulation - focus on transitions",
  duration: 55,
  rpe: 7,
  source: "manual",
  exercises: [
    EXAMPLE_EXERCISE_SLED_PUSH,
    EXAMPLE_EXERCISE_BURPEE_BROAD_JUMPS,
    EXAMPLE_EXERCISE_ROWING,
  ],
};

const EXAMPLE_UPDATE_WORKOUT = {
  duration: 52,
  rpe: 8,
  notes: "Felt stronger on the sled push rounds today",
  exercises: [EXAMPLE_EXERCISE_SLED_PUSH, EXAMPLE_EXERCISE_ROWING],
};

const EXAMPLE_WORKOUT_RESPONSE = {
  id: "0b6c5a1e-4f3d-4c2b-9a8e-7d6f5e4c3b2a",
  userId: "user_2xY9zQ",
  date: "2026-03-29",
  focus: "conditioning",
  mainWorkout: "3 rounds: Sled Push 50m, Burpee Broad Jumps x10, 1km Row",
  accessory: "Core circuit: 3x20 sit-ups, 3x30s plank",
  notes: "Hyrox simulation - focus on transitions",
  duration: 55,
  rpe: 7,
  source: "manual",
  planDayId: null,
  stravaActivityId: null,
  calories: null,
  distanceMeters: null,
  elevationGain: null,
  avgHeartrate: null,
  maxHeartrate: null,
  avgSpeed: null,
  maxSpeed: null,
  avgCadence: null,
  avgWatts: null,
  sufferScore: null,
  exerciseSets: [],
};

const EXAMPLE_PREFERENCES = {
  weightUnit: "kg",
  distanceUnit: "km",
  weeklyGoal: 4,
  emailNotifications: true,
  emailWeeklySummary: true,
  emailMissedReminder: true,
  showAdherenceInsights: true,
  aiCoachEnabled: true,
  trainingStyleId: "balanced_default",
  onboardingCompleted: true,
};

// Response shapes. The insert schemas above describe what a client SENDS; a
// stored row also carries its id, owner and server-set columns, and the
// workout endpoints attach the log's exercise sets (and structure blocks).
// Documenting responses with the insert schemas — as this registry once did —
// advertised a shape no endpoint actually returns.
export const WorkoutLogSchema = registry.register(
  "WorkoutLog",
  createSelectSchema(workoutLogs).openapi({
    title: "WorkoutLog",
    description: "A stored workout log row",
  }),
);

export const WorkoutLogWithSetsSchema = registry.register(
  "WorkoutLogWithSets",
  createSelectSchema(workoutLogs)
    .extend({
      exerciseSets: z.array(exerciseSetSchema).optional(),
      newPersonalRecords: z
        .array(
          z.object({
            exerciseKey: z.string(),
            exerciseName: z.string(),
            customLabel: z.string().nullable().optional(),
            category: z.string(),
            metric: z.string(),
            metricLabel: z.string(),
            value: z.number(),
            previousValue: z.number(),
          }),
        )
        .optional()
        .openapi({ description: "Present on create only, when the new sets set an all-time best." }),
    })
    .openapi({
      title: "WorkoutLogWithSets",
      description: "A workout log with the exercise sets it owns",
    }),
);

export const WorkoutLogDetailSchema = registry.register(
  "WorkoutLogDetail",
  createSelectSchema(workoutLogs)
    .extend({
      exerciseSets: z.array(exerciseSetSchema),
      structureBlocks: z
        .array(z.record(z.string(), z.unknown()))
        .openapi({ description: "Structured workout blocks (see the structureBlockSchema Zod type)." }),
    })
    .openapi({
      title: "WorkoutLogDetail",
      description: "A workout log with its exercise sets and structure blocks",
    }),
);

export const PreferencesResponseSchema = registry.register(
  "PreferencesResponse",
  createSelectSchema(users)
    .pick({
      weightUnit: true,
      distanceUnit: true,
      userTimezone: true,
      weeklyGoal: true,
      mealSchedule: true,
      emailNotifications: true,
      emailWeeklySummary: true,
      emailMissedReminder: true,
      showAdherenceInsights: true,
      aiCoachEnabled: true,
      coachAutoApplyPlanChanges: true,
      trainingStyleId: true,
      trainingStylePreviousId: true,
      trainingStyleChangedAt: true,
      trainingStyleRecomputeNow: true,
      onboardingCompleted: true,
      division: true,
      gender: true,
      age: true,
      bodyweightKg: true,
      heightCm: true,
      restingHr: true,
      maxHr: true,
      ftp: true,
      activityLevel: true,
      weightGoalDirection: true,
      weightGoalRateKgPerWeek: true,
      mafAge: true,
      mafInjuryIllnessMedication: true,
      mafConsistency: true,
      mafTrend: true,
      mafCategory: true,
      mafHrDataAvailable: true,
      mafHr: true,
      mafBaselineTestScheduledAt: true,
    })
    .openapi({
      title: "PreferencesResponse",
      description: "The athlete's preferences as the API serialises them (nulls filled with defaults)",
    }),
);

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
          example: EXAMPLE_CREATE_WORKOUT,
        },
      },
    },
  },
  responses: {
    200: {
      description: "The created workout log with its exercise sets",
      content: {
        "application/json": {
          schema: WorkoutLogWithSetsSchema,
          example: EXAMPLE_WORKOUT_RESPONSE,
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
          schema: z.array(WorkoutLogSchema),
          example: [EXAMPLE_WORKOUT_RESPONSE],
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
      description: "The requested workout log with its exercise sets and structure blocks",
      content: {
        "application/json": {
          schema: WorkoutLogDetailSchema,
          example: { ...EXAMPLE_WORKOUT_RESPONSE, structureBlocks: [] },
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
          example: EXAMPLE_UPDATE_WORKOUT,
        },
      },
    },
  },
  responses: {
    200: {
      description: "The updated workout log with its exercise sets",
      content: {
        "application/json": {
          schema: WorkoutLogWithSetsSchema,
          example: EXAMPLE_WORKOUT_RESPONSE,
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
          example: EXAMPLE_PREFERENCES,
        },
      },
    },
  },
  responses: {
    200: {
      description: "The full serialised preferences after the update",
      content: {
        "application/json": {
          schema: PreferencesResponseSchema,
          example: EXAMPLE_PREFERENCES,
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
      title: "fitai.coach Workout API",
      description: `
API for managing workouts, exercises, and training plans.

### Coverage
This document is generated from the Zod schemas in \`shared/openapi.ts\` and
currently describes the workout CRUD and preferences endpoints only. The
remaining \`/api/v1\` routes (plans, timeline, analytics, coach, nutrition,
integrations, …) are not yet registered here; \`server/routes/\` is their
source of truth.

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
