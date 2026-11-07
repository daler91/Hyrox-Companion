import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import { consentTypeSchema, recordConsentSchema, users } from "../schema";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/**
 * The signed-in athlete: their user record, consents and account deletion —
 * what the app needs before it shows anything else.
 */
export function registerAccountPaths(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
  schemas: { PreferencesResponse: z.ZodType },
): void {
  const User = registry.register("User", createSelectSchema(users));

  registry.registerPath({
    method: "get",
    path: "/api/v1/auth/user",
    tags: ["Account"],
    summary: "Get the signed-in user",
    description:
      "The athlete's user row, provisioned from Clerk on the first authenticated request (server/routes/auth.ts). Rate limited to 60/min because the web app polls it while the auto-coach runs.",
    security: common.security,
    responses: {
      200: { description: "The user record", content: { "application/json": { schema: User } } },
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/preferences",
    tags: ["Preferences"],
    summary: "Get user preferences",
    description: "The athlete's units, notification settings, training style and onboarding state.",
    security: common.security,
    responses: {
      200: {
        description: "The serialised preferences",
        content: { "application/json": { schema: schemas.PreferencesResponse } },
      },
      ...common.authenticatedResponses(),
    },
  });

  const ConsentType = registry.register("ConsentType", consentTypeSchema);

  registry.registerPath({
    method: "post",
    path: "/api/v1/consents",
    tags: ["Account"],
    summary: "Record a consent decision",
    description:
      "Stores an auditable consent decision (GDPR Art. 7): the privacy notice acknowledgement or the error-reporting opt-in/out. The latest decision per type is kept.",
    security: common.security,
    request: {
      body: {
        content: {
          "application/json": {
            schema: recordConsentSchema,
            example: { consentType: "privacy_notice", granted: true },
          },
        },
      },
    },
    responses: {
      ...common.success("Recorded"),
      ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/consents",
    tags: ["Account"],
    summary: "List recorded consent decisions",
    description: "The athlete's recorded consent decisions, newest first.",
    security: common.security,
    responses: {
      200: {
        description: "Consent decisions",
        content: {
          "application/json": {
            schema: z.object({
              consents: z.array(
                z.object({
                  consentType: ConsentType,
                  granted: z.boolean(),
                  consentedAt: z.string().datetime(),
                }),
              ),
            }),
          },
        },
      },
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/account",
    tags: ["Account"],
    summary: "Delete the account and all its data",
    description:
      "Permanent erasure (GDPR Art. 17): the Clerk identity, every user-owned row and the vector-DB copies. Resumable: a run that fails after the Clerk identity is gone is finished by the erasure sweep. Rate limited to 3 per window.",
    security: common.security,
    responses: {
      ...common.success("The account was erased"),
      ...common.error(404, "No such user"),
      ...common.authenticatedResponses(),
    },
  });
}
