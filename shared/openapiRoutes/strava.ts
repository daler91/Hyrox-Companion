import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import { CODE_CHALLENGE_PATTERN, stravaNativeCompleteSchema } from "../schema";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/**
 * Strava connection, from the app's side: status and the native connect flow
 * (code challenge in, App Link back, verifier to finish). The browser
 * callback and the webhook receiver are not client endpoints.
 */
export function registerStravaPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const AutoSync = z.object({
    enabled: z.boolean(),
    webhook: z.boolean().openapi({ description: "Whether Strava pushes new activities (else polling)" }),
    intervalMinutes: z.number().int(),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/strava/status",
    tags: ["Strava"],
    summary: "Get the Strava connection status",
    security: common.security,
    responses: {
      200: {
        description: "Connected (with the athlete and sync details) or not",
        content: {
          "application/json": {
            schema: z.object({
              connected: z.boolean(),
              athleteId: z.string().optional(),
              lastSyncedAt: z.string().datetime().nullable().optional(),
              requiresReauth: z.boolean().optional().openapi({
                description: "Strava revoked the grant; the athlete must connect again",
              }),
              autoSync: AutoSync,
            }),
          },
        },
      },
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/strava/auth",
    tags: ["Strava"],
    summary: "Start connecting Strava",
    description:
      "Returns Strava's consent URL. The native app passes `codeChallenge` = base64url(SHA-256(verifier)) and gets Strava's mobile consent page, which redirects to the App Link `/strava/mobile-callback`; it then finishes with POST /api/v1/strava/native/complete. Without `codeChallenge` this is the browser flow, which also sets a binding cookie.",
    security: common.security,
    request: {
      query: z.object({
        codeChallenge: z.string().regex(CODE_CHALLENGE_PATTERN).optional().openapi({
          description: "Native app only: base64url(SHA-256(verifier)), 43 characters (RFC 7636 S256)",
        }),
      }),
    },
    responses: {
      200: {
        description: "The URL to open for Strava's consent screen",
        content: { "application/json": { schema: z.object({ authUrl: z.string().url() }) } },
      },
      ...common.error(400, "VALIDATION_ERROR: malformed codeChallenge"),
      ...common.error(500, "Strava is not configured on this server"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/strava/native/complete",
    tags: ["Strava"],
    summary: "Finish connecting Strava from the native app",
    description:
      "The app posts the `code` and `state` from Strava's App Link redirect plus the verifier whose challenge it sent to /auth. The account is linked only if the state is valid, unexpired, unused, minted for the caller, and the verifier matches; every refusal is the same 403. On success the first import is queued.",
    security: common.security,
    request: {
      body: { content: { "application/json": { schema: stravaNativeCompleteSchema } } },
    },
    responses: {
      ...common.success("Connected"),
      ...common.error(400, "VALIDATION_ERROR: malformed body"),
      ...common.error(403, "FORBIDDEN: the connection could not be verified"),
      ...common.error(502, "EXTERNAL_API_ERROR: Strava did not accept the code"),
      ...common.authenticatedResponses(),
    },
  });
}
