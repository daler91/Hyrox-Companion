import type { OpenAPIRegistry, ResponseConfig } from "@asteasolutions/zod-to-openapi";

import { z } from "../schema/zod";

/**
 * Components every path module shares: the bearer security scheme, the two
 * error envelopes the API answers with, and response helpers built on them.
 *
 * The API has two error shapes, and both are documented rather than papered
 * over (CODEBASE_ANALYSIS_2026-08-31 A6):
 * - `ErrorResponse` — `{ error, code, details? }`, from route handlers and the
 *   global error handler. `code` is a member of ErrorCode (server/errors.ts).
 * - `ValidationErrorResponse` — `{ code: "VALIDATION_ERROR", message, details }`,
 *   from the Zod body/query/params middleware (sendValidationError in
 *   server/routeUtils.ts).
 */
export interface OpenApiCommon {
  /** `security` for an operation that requires a signed-in user. */
  readonly security: Array<Record<string, string[]>>;
  /** One error response with the `{ error, code }` envelope. */
  error(status: number, description: string): Record<number, ResponseConfig>;
  /** A 400 from the Zod validation middleware. */
  validationError(description?: string): Record<number, ResponseConfig>;
  /**
   * Responses any authenticated /api/v1 operation can give regardless of what
   * it does: 401 (not signed in), 426 (native app build below the minimum)
   * and 429 (rate limited).
   */
  authenticatedResponses(): Record<number, ResponseConfig>;
  /** A 200 `{ success: true }` acknowledgement. */
  success(description: string): Record<number, ResponseConfig>;
}

export function registerCommonComponents(registry: OpenAPIRegistry): OpenApiCommon {
  const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Enter your Clerk JWT token in the format: Bearer <token>",
  });
  const security = [{ [bearerAuth.name]: [] }];

  const ErrorResponse = registry.register(
    "ErrorResponse",
    z.object({
      error: z.string().openapi({ description: "Human-readable message", example: "Unauthorized" }),
      code: z.string().openapi({
        description: "Machine-readable code, a member of ErrorCode (server/errors.ts)",
        example: "UNAUTHORIZED",
      }),
      details: z
        .record(z.string(), z.unknown())
        .optional()
        .openapi({ description: "Extra context; present on some 4xx responses only" }),
    }),
  );

  const ValidationErrorResponse = registry.register(
    "ValidationErrorResponse",
    z.object({
      code: z.literal("VALIDATION_ERROR"),
      message: z.string().openapi({ description: "The first issue's message", example: "Invalid input" }),
      details: z.object({
        issues: z.array(
          z.object({
            path: z.string().openapi({ example: "token" }),
            message: z.string().openapi({ example: "Device token must be an FCM registration token" }),
          }),
        ),
      }),
    }),
  );

  const AppUpdateRequiredResponse = registry.register(
    "AppUpdateRequiredResponse",
    z.object({
      error: z.string().openapi({ example: "This version of the app is no longer supported. Update it to keep going." }),
      code: z.literal("APP_UPDATE_REQUIRED"),
      minimumVersion: z.string().openapi({ description: "Oldest build the API still serves", example: "1.4.0" }),
    }),
  );

  const SuccessResponse = registry.register("SuccessResponse", z.object({ success: z.literal(true) }));

  const json = (schema: z.ZodType) => ({ "application/json": { schema } });

  const error = (status: number, description: string): Record<number, ResponseConfig> => ({
    [status]: { description, content: json(ErrorResponse) },
  });

  return {
    security,
    error,
    validationError: (description = "The request failed validation") => ({
      400: { description, content: json(ValidationErrorResponse) },
    }),
    authenticatedResponses: () => ({
      ...error(401, "Not signed in, or the bearer token was rejected"),
      426: {
        description:
          "Native app only: the X-App-Version build is older than the server's minimum for its X-App-Platform",
        content: json(AppUpdateRequiredResponse),
      },
      ...error(429, "Rate limited; Retry-After says when to try again"),
    }),
    success: (description: string) => ({ 200: { description, content: json(SuccessResponse) } }),
  };
}
