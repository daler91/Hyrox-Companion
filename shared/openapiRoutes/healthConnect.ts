import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import { healthConnectSyncSchema } from "../schema";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/** Health Connect: the Android app's sync of exercise sessions. */
export function registerHealthConnectPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  registry.registerPath({
    method: "post",
    path: "/api/v1/health-connect/sync",
    tags: ["Health Connect"],
    summary: "Import Health Connect exercise sessions",
    description:
      "Imports the exercise sessions the app read from Health Connect since its last sync, and moves the imports of sessions deleted there to the recycle bin. Each session becomes a standalone workout with its synthesised set, unless it is already imported (by its id, live or in the bin), was written by the Strava or Garmin Connect app while that provider is connected, or matches a stored Strava, Garmin or Health Connect recording (start within two minutes, similar length, compatible sport). A later Strava or Garmin import of the same session supersedes the Health Connect one. At most 100 sessions and 500 deletions per request.",
    security: common.security,
    request: {
      body: {
        content: {
          "application/json": {
            schema: healthConnectSyncSchema,
            example: {
              sessions: [
                {
                  id: "0b3c6f9e-0f43-4a8e-9a39-2f0c1d1b7a11",
                  startTime: "2026-11-08T07:02:00Z",
                  endTime: "2026-11-08T07:48:30Z",
                  zoneOffsetMinutes: 60,
                  sportType: "Run",
                  title: "Morning run",
                  distanceMeters: 8120,
                  activeCalories: 610,
                  avgHeartRate: 151,
                  maxHeartRate: 172,
                  dataOrigin: "com.sec.android.app.shealth",
                },
              ],
              deletedIds: [],
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: "Imported; `skipped` counts sessions not imported, `deleted` the imports moved to the bin",
        content: {
          "application/json": {
            schema: z.object({
              imported: z.number().int(),
              skipped: z.number().int(),
              deleted: z.number().int(),
            }),
          },
        },
      },
      ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });
}
