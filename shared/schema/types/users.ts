import { type NumberBound, PREFERENCE_NUMBER_BOUNDS as BOUNDS } from "../../preferenceBounds";
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

/** A number held to one of the shared preference ranges (shared/preferenceBounds.ts). */
function boundedNumber(bound: NumberBound) {
  const base = bound.integer ? z.number().int() : z.number();
  const floored = bound.minExclusive ? base.gt(bound.min) : base.min(bound.min);
  return floored.max(bound.max);
}

// A per-email send-hour override: an hour of day, or null to fall back to the
// athlete's default send time.
const notifyHourOverrideSchema = z.number().int().min(0).max(23).nullable().optional();

export const updateUserPreferencesSchema = z.object({
  weightUnit: z.enum(["kg", "lbs"]).optional(),
  distanceUnit: z.enum(["km", "miles"]).optional(),
  userTimezone: ianaTimezoneSchema.optional(),
  // A whole number of sessions: the column is an integer, and Postgres refused
  // 4.5 with a 500 (C50, CODEBASE_ANALYSIS_2026-10-03).
  weeklyGoal: boundedNumber(BOUNDS.weeklyGoal).optional(),
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
  emailWeeklyReviewReminder: z.boolean().optional(),
  emailTodaySession: z.boolean().optional(),
  emailAnalysisDigest: z.boolean().optional(),
  // Local hour (0–23) at which the hourly email tick fires for this athlete —
  // the default behind every email that has no send hour of its own.
  notifyHour: z.number().int().min(0).max(23).optional(),
  // Per-email send-hour overrides. Explicit null clears an override and puts
  // that email back on the default above (see shared/notifyHours.ts).
  notifyHourWeeklySummary: notifyHourOverrideSchema,
  notifyHourMissedReminder: notifyHourOverrideSchema,
  notifyHourWeeklyReviewReminder: notifyHourOverrideSchema,
  notifyHourTodaySession: notifyHourOverrideSchema,
  notifyHourAnalysisDigest: notifyHourOverrideSchema,
  // Nutrition push reminders (opt-in; push-only, independent of the email
  // master toggle — they only fire for users with a push subscription).
  pushRefuelReminder: z.boolean().optional(),
  pushLoggingReminder: z.boolean().optional(),
  showAdherenceInsights: z.boolean().optional(),
  aiCoachEnabled: z.boolean().optional(),
  // Conversational plan editing: apply the coach's chat proposals immediately
  // instead of waiting for an explicit Apply tap.
  coachAutoApplyPlanChanges: z.boolean().optional(),
  trainingStyleId: z.string().max(100).nullable().optional(),
  trainingStylePreviousId: z.string().max(100).nullable().optional(),
  trainingStyleChangedAt: z.coerce.date().nullable().optional(),
  trainingStyleRecomputeNow: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
  // Athlete competition profile for the Race Predictor.
  division: z.enum(["open", "pro"]).optional(),
  gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable().optional(),
  // General age cohort signal for the Race Predictor (W17), independent of MAF.
  age: boundedNumber(BOUNDS.age).nullable().optional(),
  // Body-composition inputs for calculated nutrition targets. Canonical units
  // on the wire (kg/cm); the client converts from the user's display unit at the
  // input edge before PATCHing.
  bodyweightKg: boundedNumber(BOUNDS.bodyweightKg).nullable().optional(),
  heightCm: boundedNumber(BOUNDS.heightCm).nullable().optional(),
  // Training-load physiological baselines for objective cardio load (hrTSS/TSS).
  // Optional; absent values fall back to age-estimated max HR + a default resting HR.
  restingHr: boundedNumber(BOUNDS.restingHr).nullable().optional(),
  maxHr: boundedNumber(BOUNDS.maxHr).nullable().optional(),
  ftp: boundedNumber(BOUNDS.ftp).nullable().optional(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).nullable().optional(),
  weightGoalDirection: z.enum(["lose", "maintain", "gain"]).nullable().optional(),
  weightGoalRateKgPerWeek: boundedNumber(BOUNDS.weightGoalRateKgPerWeek).nullable().optional(),
  // Durable injuries/limitations, seeded from the plan generator's textarea.
  // Same 500-char bound as generatePlanInputSchema.injuries, which feeds it.
  trainingConstraints: z.string().max(500).nullable().optional(),
  mafAge: boundedNumber(BOUNDS.mafAge).nullable().optional(),
  mafInjuryIllnessMedication: z.boolean().nullable().optional(),
  mafConsistency: z.enum(["low", "moderate", "high"]).nullable().optional(),
  mafTrend: z.enum(["improving", "flat", "declining"]).nullable().optional(),
  // Maffetone's category question, asked directly (audit M6). Values mirror
  // MafCategory in shared/maf.ts.
  mafCategory: z
    .enum([
      "recovering_or_medicated",
      "training_interrupted",
      "consistent_up_to_2y",
      "consistent_2y_plus_improving",
    ])
    .nullable()
    .optional(),
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

