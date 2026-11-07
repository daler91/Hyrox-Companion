import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import { registerDeviceTokenSchema, unregisterDeviceTokenSchema } from "../schema";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/**
 * Notifications: native app push registration (FCM), the browser's Web Push
 * subscription, a test push, and the opportunistic email check.
 *
 * The Web Push bodies are described here rather than imported: their route
 * schemas validate the endpoint with the server's SSRF guard and push-service
 * allowlist (server/routes/push.ts), which cannot live in shared/.
 */
export function registerPushPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  registry.registerPath({
    method: "post",
    path: "/api/v1/push/devices",
    tags: ["Push"],
    summary: "Register this app install for push",
    description:
      "Registers (or refreshes) the install's FCM registration token. Call on every launch and whenever FCM rotates the token. A token another athlete held moves to the caller, so a shared phone notifies whoever is signed in. At most 10 installs per user; the least recently seen is evicted. A well-formed X-App-Version is stored with the token.",
    security: common.security,
    request: {
      body: {
        content: {
          "application/json": {
            schema: registerDeviceTokenSchema,
            example: { token: "dQw4w9WgXcQ:APA91bH-example", platform: "android" },
          },
        },
      },
    },
    responses: {
      ...common.success("Registered"),
      ...common.validationError(),
      ...common.error(404, "PUSH_NOT_CONFIGURED: native push is not configured on this server"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/push/devices",
    tags: ["Push"],
    summary: "Unregister this app install",
    description: "Removes the install's token for the signed-in athlete, on sign-out. Only the caller's own row is touched.",
    security: common.security,
    request: {
      body: { content: { "application/json": { schema: unregisterDeviceTokenSchema } } },
    },
    responses: {
      ...common.success("Unregistered (also when the token was not registered)"),
      ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });

  registerWebPushPaths(registry, common);

  registry.registerPath({
    method: "post",
    path: "/api/v1/push/test",
    tags: ["Push"],
    summary: "Send a test notification",
    description:
      "Sends a test notification to every browser subscription and app install the athlete has registered. Rate limited to 5 per window.",
    security: common.security,
    responses: {
      200: {
        description: "Sent; `sent` counts the deliveries that succeeded (0 when push is not configured)",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), sent: z.number().int() }),
          },
        },
      },
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/emails/check",
    tags: ["Email"],
    summary: "Send any emails now due",
    description:
      "Sends the weekly summary and the missed-workout reminder if either is due and the athlete has it turned on; the web app calls this once per signed-in session. Rate limited to 5 per window.",
    security: common.security,
    responses: {
      200: {
        description: "The emails sent by this call, possibly none",
        content: {
          "application/json": {
            schema: z.object({
              sent: z.array(z.enum(["weekly_summary", "missed_reminder"])),
            }),
          },
        },
      },
      ...common.authenticatedResponses(),
    },
  });
}

/** Browser push (Web Push with VAPID keys); the native app uses /api/v1/push/devices instead. */
function registerWebPushPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const httpsEndpoint = z.string().url().openapi({
    description:
      "The PushSubscription endpoint: an HTTPS URL that does not point at a local or private address",
    example: "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH-example",
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/push/vapid-key",
    tags: ["Push"],
    summary: "Get the Web Push public key",
    description: "The VAPID public key a browser passes to PushManager.subscribe. Browser only.",
    security: common.security,
    responses: {
      200: {
        description: "The key",
        content: { "application/json": { schema: z.object({ publicKey: z.string() }) } },
      },
      ...common.error(404, "PUSH_NOT_CONFIGURED: Web Push is not configured on this server"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/push/subscribe",
    tags: ["Push"],
    summary: "Save a browser push subscription",
    description:
      "Stores the browser's PushSubscription for the athlete. An endpoint another athlete held moves to the caller; re-saving one updates its keys. Browser only.",
    security: common.security,
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              endpoint: httpsEndpoint.max(2048).openapi({
                description:
                  "The PushSubscription endpoint: an HTTPS URL on a known browser push service (FCM, Mozilla autopush, Apple or WNS) that does not point at a local or private address",
              }),
              keys: z.object({
                p256dh: z.string().min(1).max(512),
                auth: z.string().min(1).max(512),
              }),
            }),
          },
        },
      },
    },
    responses: {
      ...common.success("Saved"),
      ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/push/unsubscribe",
    tags: ["Push"],
    summary: "Remove a browser push subscription",
    description: "Deletes the athlete's subscription with this endpoint. Browser only.",
    security: common.security,
    request: {
      body: { content: { "application/json": { schema: z.object({ endpoint: httpsEndpoint }) } } },
    },
    responses: {
      ...common.success("Removed (also when no such subscription existed)"),
      ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });
}
