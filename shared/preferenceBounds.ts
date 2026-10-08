/**
 * Ranges for the numeric preferences, shared by the server's
 * `updateUserPreferencesSchema` (shared/schema/types/users.ts) and the
 * Settings form's pre-save check (client/src/pages/settings/preferencesValidation.ts).
 * A plain module on purpose: the schema module imports the drizzle tables and
 * the zod-to-openapi-patched `z`, which must never reach a browser chunk
 * (bundle-check invariant 2), so the client reads the bounds from here instead.
 */
export interface NumberBound {
  readonly min: number;
  /** The value must be above `min` rather than at least `min`. */
  readonly minExclusive?: boolean;
  readonly max: number;
  readonly integer?: boolean;
}

export const PREFERENCE_NUMBER_BOUNDS = {
  weeklyGoal: { min: 1, max: 14, integer: true },
  // General age cohort signal for the Race Predictor (W17), independent of MAF.
  age: { min: 13, max: 100, integer: true },
  bodyweightKg: { min: 0, minExclusive: true, max: 500 },
  heightCm: { min: 0, minExclusive: true, max: 300 },
  restingHr: { min: 30, max: 120, integer: true },
  maxHr: { min: 120, max: 230, integer: true },
  ftp: { min: 50, max: 600, integer: true },
  weightGoalRateKgPerWeek: { min: 0, max: 2 },
  mafAge: { min: 16, max: 99, integer: true },
} as const satisfies Record<string, NumberBound>;

export type BoundedPreference = keyof typeof PREFERENCE_NUMBER_BOUNDS;
