import { z } from "../zod";

// Request schemas for the analytics, session-grade and Garmin endpoints. They
// live here, not beside their routes, so the route validation and the OpenAPI
// document (shared/openapiRoutes) are the same object and cannot drift apart.

/** The longest day count the Analytics page offers is a year; longer is "all". */
const MAX_OVERVIEW_RANGE_DAYS = 366;

/**
 * The Analytics page's own `range` value: a day count, or "all" (parsed to
 * null). AI31 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const overviewRangeSchema = z.union([
  z.literal("all").transform(() => null),
  z.coerce.number().int().min(1).max(MAX_OVERVIEW_RANGE_DAYS),
]);

/** GET and POST /api/v1/overview-analysis */
export const overviewAnalysisQuerySchema = z.object({
  range: overviewRangeSchema.optional().openapi({
    description:
      'The Analytics page range: a day count (1-366, the last N days ending on the athlete\'s today) or "all". POST defaults to 90; GET without it returns whatever is stored.',
    example: "90",
  }),
});
export type OverviewAnalysisQuery = z.infer<typeof overviewAnalysisQuerySchema>;

/** GET /api/v1/session-grades. Defaults to the active plan. */
export const sessionGradesQuerySchema = z
  .object({
    planId: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .openapi({ description: "The plan to grade; the active plan when omitted" }),
  })
  .strict();
export type SessionGradesQuery = z.infer<typeof sessionGradesQuerySchema>;

/**
 * POST /api/v1/garmin/connect. Obviously bad input is refused here so it never
 * reaches Garmin's SSO, its most rate-limited surface.
 */
export const garminConnectBodySchema = z.object({
  email: z.string().trim().email("Invalid email").max(254),
  password: z.string().min(1, "Password required").max(256),
});
export type GarminConnectBody = z.infer<typeof garminConnectBodySchema>;
