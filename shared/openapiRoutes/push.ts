import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import { registerDeviceTokenSchema, unregisterDeviceTokenSchema } from "../schema";
import type { OpenApiCommon } from "./common";

/** Native app push registration (FCM). Browser push stays web-only and undocumented here. */
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
}
