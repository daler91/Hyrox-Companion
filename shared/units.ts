/**
 * Unit-carrying types for the numbers this app stores and does arithmetic on.
 *
 * See `docs/adr-units.md` for the column-by-column contract. The short version:
 * a column's unit must live in its NAME or its TYPE, never only in a comment,
 * because comments do not fail a build and three separate 60x errors shipped
 * behind columns whose unit was documented in prose (audit C7, H1, H2).
 *
 * ## What a brand does and does not catch
 *
 * A branded number is still a `number` at runtime and still a `number` to the
 * arithmetic operators, so this does NOT error:
 *
 * ```ts
 * const total = someMinutes + someSeconds; // allowed: both are numbers
 * ```
 *
 * What it does catch is ASSIGNMENT across units, which is the exact shape of
 * every unit bug in the audit — a minutes-valued expression handed to a
 * seconds-typed field:
 *
 * ```ts
 * const metrics: MafTestMetrics = { durationSeconds: workout.duration };
 * //                               ^ Minutes is not assignable to Seconds
 * ```
 *
 * Mixed arithmetic is covered by the naming rule in the ADR instead: an
 * identifier holding a duration must end in `Seconds` or `Minutes`, so mixing
 * them is visible on the line rather than inferable only from a type alias.
 */

declare const unitBrand: unique symbol;

/** A number tagged with the unit it is measured in. */
type Unit<Tag extends string> = number & { readonly [unitBrand]: Tag };

/** Whole or fractional minutes. The canonical unit of `exercise_sets.time`. */
export type Minutes = Unit<"minutes">;
/** Whole or fractional seconds. The canonical unit of `maf_test_results.duration_seconds`. */
export type Seconds = Unit<"seconds">;
/** Metres. The canonical unit of `workout_logs.distance_meters`. */
export type Metres = Unit<"metres">;
/** Kilograms. Canonical only where a column says so — see the ADR on stored weights. */
export type Kilograms = Unit<"kilograms">;

export const SECONDS_PER_MINUTE = 60;

/**
 * Metres in a statute mile. Defined once here because it used to be defined
 * twice in `unitConversion.ts` — `METERS_PER_MILE = 1609.34` alongside
 * `KM_TO_MILES = 0.621371`, whose reciprocal is 1609.3445 — so two call paths
 * disagreed by 2.5 ppm on the same conversion (audit L6).
 */
export const METRES_PER_MILE = 1609.344;

/** Tag a number that is already in minutes. */
export function minutes(value: number): Minutes {
  return value as Minutes;
}

/** Tag a number that is already in seconds. */
export function seconds(value: number): Seconds {
  return value as Seconds;
}

/** Tag a number that is already in metres. */
export function metres(value: number): Metres {
  return value as Metres;
}

/** Tag a number that is already in kilograms. */
export function kilograms(value: number): Kilograms {
  return value as Kilograms;
}

export function secondsToMinutes(value: Seconds): Minutes {
  return (value / SECONDS_PER_MINUTE) as Minutes;
}

export function minutesToSeconds(value: Minutes): Seconds {
  return (value * SECONDS_PER_MINUTE) as Seconds;
}

/**
 * Drop the brand. Use at the edges — a DB insert, a JSON response, a format
 * call — where the receiving type is a plain `number` and the unit has already
 * been established by the column or the parameter name.
 */
export function unitless(value: Unit<string>): number {
  return value;
}

/**
 * Render a duration the way an athlete reads it, choosing the scale from the
 * magnitude rather than from a hardcoded suffix.
 *
 * A minutes column holds sub-minute values once seconds-valued inputs are
 * converted on the way in (a 45-second transition is 0.75), and `0.75min` is
 * not something anyone wants to read. Below a minute this renders seconds;
 * above it, minutes, dropping a trailing `.0`.
 */
export function formatMinutes(value: Minutes): string {
  if (!Number.isFinite(value)) return "";
  if (value < 1) return `${Math.round(value * SECONDS_PER_MINUTE)}s`;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}min` : `${rounded.toFixed(1)}min`;
}
