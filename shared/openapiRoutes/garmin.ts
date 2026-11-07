import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import { garminConnectBodySchema } from "../schema/types/analyticsRequests";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/**
 * Garmin Connect: status, connect with the athlete's Garmin email and
 * password, disconnect, and a manual activity sync. Garmin bans the server's
 * shared IP when it is called too often, so the server refuses overlapping
 * requests (GARMIN_BUSY), syncs closer than five minutes apart
 * (GARMIN_SYNC_TOO_SOON), retries after a failed sync until the athlete
 * reconnects (GARMIN_RECONNECT_REQUIRED), and freezes every Garmin call for
 * 30 minutes after Garmin rate-limits it (GARMIN_CIRCUIT_OPEN).
 */
export function registerGarminPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const circuitOpen = common.error(
    503,
    "GARMIN_CIRCUIT_OPEN: Garmin rate-limited this server, so all Garmin calls are paused for a while; try again later",
  );
  const busy = common.error(
    409,
    "GARMIN_BUSY: another connect or sync for this athlete is still running",
  );

  registry.registerPath({
    method: "get",
    path: "/api/v1/garmin/status",
    tags: ["Garmin"],
    summary: "Get the Garmin connection status",
    security: common.security,
    responses: {
      200: {
        description:
          "Connected (with the sync details) or not; only `connected` is present when not connected",
        content: {
          "application/json": {
            schema: z.object({
              connected: z.boolean(),
              garminDisplayName: z.string().nullable().optional().openapi({
                description: "Garmin's profile display name (an opaque handle, not the email)",
              }),
              lastSyncedAt: z.string().datetime().nullable().optional(),
              lastError: z.string().nullable().optional().openapi({
                description:
                  "Set when a sync failed; the athlete must disconnect and connect again",
              }),
            }),
          },
        },
      },
      ...common.error(500, "INTERNAL_SERVER_ERROR: the status could not be read"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/garmin/connect",
    tags: ["Garmin"],
    summary: "Connect Garmin",
    description:
      "Logs in to Garmin with the athlete's Garmin credentials and, only if that succeeds, stores them encrypted with the session tokens. Replaces any existing connection, so the next sync backfills 90 days again. Rate limited to 5 per 15 minutes.",
    security: common.security,
    request: { body: { content: { "application/json": { schema: garminConnectBodySchema } } } },
    responses: {
      200: {
        description: "Connected",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              garminDisplayName: z
                .string()
                .nullable()
                .openapi({ description: "Null when Garmin's profile lookup failed" }),
            }),
          },
        },
      },
      ...common.validationError(),
      ...busy,
      ...circuitOpen,
      ...common.authenticatedResponses(),
      ...common.error(
        401,
        "Not signed in; or GARMIN_AUTH_FAILED, Garmin refused the login (the message says why)",
      ),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/garmin/disconnect",
    tags: ["Garmin"],
    summary: "Disconnect Garmin",
    description: "Deletes the stored connection and credentials. Imported workouts stay.",
    security: common.security,
    responses: {
      ...common.success("Disconnected (also when nothing was connected)"),
      ...common.error(500, "INTERNAL_SERVER_ERROR: the connection could not be deleted"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/garmin/sync",
    tags: ["Garmin"],
    summary: "Sync Garmin activities",
    description:
      "Imports activities since the last sync less a week (90 days back on the first sync), at most 100 per call. Rate limited to 5 per 15 minutes, and at most one successful sync every 5 minutes.",
    security: common.security,
    responses: {
      200: {
        description: "Synced",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              imported: z.number().int(),
              skipped: z
                .number()
                .int()
                .openapi({ description: "Already imported, or already imported from Strava" }),
              total: z.number().int().openapi({ description: "Activities Garmin returned" }),
            }),
          },
        },
      },
      ...common.error(404, "GARMIN_NOT_CONNECTED: no Garmin connection"),
      ...busy,
      ...common.error(
        502,
        "GARMIN_API_ERROR: Garmin failed or refused the request (when Garmin rejected the login, the connection now needs a reconnect)",
      ),
      ...circuitOpen,
      ...common.authenticatedResponses(),
      ...common.error(
        401,
        "Not signed in; GARMIN_RECONNECT_REQUIRED, an earlier sync failed and the athlete must disconnect and connect again; or GARMIN_AUTH_FAILED, the stored login no longer works",
      ),
      ...common.error(
        429,
        "RATE_LIMITED; or GARMIN_SYNC_TOO_SOON, the last sync was under 5 minutes ago (the message says how long to wait)",
      ),
    },
  });
}
