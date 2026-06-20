import { userConsents, users } from "../tables";
import { z } from "../zod";
// User types and schemas
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// IANA timezone validation. We keep the format check shallow here (any
// non-empty string with no whitespace) and defer the authoritative check to
// the route handler, which uses Intl.DateTimeFormat to reject names the
// platform doesn't recognize — the schema layer doesn't have access to that
// in the browser/edge runtime in a portable way.
const ianaTimezoneSchema = z.string().min(1).max(64).regex(/^[^\s]+$/, "must be a non-whitespace IANA name");

export const updateUserPreferencesSchema = z.object({
  weightUnit: z.enum(["kg", "lbs"]).optional(),
  distanceUnit: z.enum(["km", "miles"]).optional(),
  userTimezone: ianaTimezoneSchema.optional(),
  weeklyGoal: z.number().min(1).max(14).optional(),
  // Meal-pattern preset: how many eating meals/day the per-meal fuel targets are
  // split across. 3 = breakfast/lunch/dinner, 4 = +snack, 5 = +afternoon snack.
  mealSchedule: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
  // Master toggle — when false, no email is ever sent regardless of
  // the per-type flags below. Kept for backward compatibility with
  // older clients that only know about this field.
  emailNotifications: z.boolean().optional(),
  // Per-type toggles. Take effect only when the master toggle is on.
  // Default behavior (both true) preserves pre-migration behavior for
  // existing users.
  emailWeeklySummary: z.boolean().optional(),
  emailMissedReminder: z.boolean().optional(),
  showAdherenceInsights: z.boolean().optional(),
  aiCoachEnabled: z.boolean().optional(),
  trainingStyleId: z.string().max(100).nullable().optional(),
  trainingStylePreviousId: z.string().max(100).nullable().optional(),
  trainingStyleChangedAt: z.coerce.date().nullable().optional(),
  trainingStyleRecomputeNow: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
  // Athlete competition profile for the Race Predictor.
  division: z.enum(["open", "pro"]).optional(),
  gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable().optional(),
  // General age cohort signal for the Race Predictor (W17), independent of MAF.
  age: z.number().int().min(13).max(100).nullable().optional(),
  // Body-composition inputs for calculated nutrition targets. Canonical units
  // on the wire (kg/cm); the client converts from the user's display unit at the
  // input edge before PATCHing.
  bodyweightKg: z.number().positive().max(500).nullable().optional(),
  heightCm: z.number().positive().max(300).nullable().optional(),
  // Training-load physiological baselines for objective cardio load (TRIMP/TSS).
  // Optional; absent values fall back to age-estimated max HR + a default resting HR.
  restingHr: z.number().int().min(30).max(120).nullable().optional(),
  maxHr: z.number().int().min(120).max(230).nullable().optional(),
  ftp: z.number().int().min(50).max(600).nullable().optional(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).nullable().optional(),
  weightGoalDirection: z.enum(["lose", "maintain", "gain"]).nullable().optional(),
  weightGoalRateKgPerWeek: z.number().nonnegative().max(2).nullable().optional(),
  mafAge: z.number().int().min(16).max(99).nullable().optional(),
  mafInjuryIllnessMedication: z.boolean().nullable().optional(),
  mafConsistency: z.enum(["low", "moderate", "high"]).nullable().optional(),
  mafTrend: z.enum(["improving", "flat", "declining"]).nullable().optional(),
  mafHrDataAvailable: z.boolean().nullable().optional(),
  mafHr: z.number().int().min(70).max(220).nullable().optional(),
  mafBaselineTestScheduledAt: z.coerce.date().nullable().optional(),
});

export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;

// Auditable consent records (W4). `privacy_notice` = the first-load privacy
// banner acknowledgement; `error_reporting` = the Sentry telemetry opt-in,
// split from the notice so accept/reject are recorded independently.
export const consentTypeSchema = z.enum(["privacy_notice", "error_reporting"]);
export type ConsentType = z.infer<typeof consentTypeSchema>;

export const recordConsentSchema = z.object({
  consentType: consentTypeSchema,
  granted: z.boolean(),
});
export type RecordConsentInput = z.infer<typeof recordConsentSchema>;

export type UserConsent = typeof userConsents.$inferSelect;

