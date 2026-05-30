import { users } from "../tables";
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
  mafAge: z.number().int().min(16).max(99).nullable().optional(),
  mafInjuryIllnessMedication: z.boolean().nullable().optional(),
  mafConsistency: z.enum(["low", "moderate", "high"]).nullable().optional(),
  mafTrend: z.enum(["improving", "flat", "declining"]).nullable().optional(),
  mafHrDataAvailable: z.boolean().nullable().optional(),
  mafHr: z.number().int().min(70).max(220).nullable().optional(),
  mafBaselineTestScheduledAt: z.coerce.date().nullable().optional(),
});

export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;

