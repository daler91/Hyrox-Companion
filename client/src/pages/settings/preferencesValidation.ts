import { type NumberBound, PREFERENCE_NUMBER_BOUNDS } from "@shared/preferenceBounds";
import { kgToUserWeight } from "@shared/unitConversion";

import { parseApiError } from "@/lib/apiError";

/**
 * Settings has one Save bar for every tab, and the server refuses the whole
 * PATCH when any one value is out of range: a resting HR of 25 or a weekly
 * rate of 5 lbs left every later save failing with "Please try again" and
 * nothing pointing at the field. The payload is checked here against the same
 * ranges the server's schema is built from (shared/preferenceBounds.ts; the
 * schema itself must not reach the browser), and the refusal names the field,
 * its allowed range in the units the athlete sees, and the tab it is on.
 * U35 (CODEBASE_ANALYSIS_2026-10-03)
 */

interface FieldCopy {
  readonly label: string;
  /** The unit the bound is shown in; omitted for a plain count such as age. */
  readonly unit?: string;
  /** The value is sent in kg but shown in the athlete's weight unit. */
  readonly weight?: boolean;
}

// Every numeric field the preferences form sends; all sit on the Training tab.
const FIELD_COPY: ReadonlyMap<string, FieldCopy> = new Map<string, FieldCopy>([
  ["age", { label: "Age" }],
  ["bodyweightKg", { label: "Bodyweight", weight: true }],
  ["heightCm", { label: "Height", unit: "cm" }],
  ["restingHr", { label: "Resting heart rate", unit: "bpm" }],
  ["maxHr", { label: "Max heart rate", unit: "bpm" }],
  ["ftp", { label: "Functional threshold power", unit: "W" }],
  ["weightGoalRateKgPerWeek", { label: "Weekly rate", weight: true }],
  ["weeklyGoal", { label: "Weekly workout goal" }],
  ["mafAge", { label: "MAF age" }],
]);

const BOUNDS: ReadonlyMap<string, NumberBound> = new Map<string, NumberBound>(
  Object.entries(PREFERENCE_NUMBER_BOUNDS),
);

const WHERE = "Fix it on the Training tab, then save again.";

/** A bound in the units the field is shown in, rounded for display. */
function formatBound(bound: number, copy: FieldCopy, weightUnit: string): string {
  if (copy.weight) {
    const shown = Math.round(kgToUserWeight(bound, weightUnit) * 10) / 10;
    return `${String(shown)} ${weightUnit}`;
  }
  return copy.unit ? `${String(bound)} ${copy.unit}` : String(bound);
}

/** What is wrong with a value outside its range, e.g. "must be at least 30 bpm"; null when it is fine. */
function describeRule(value: unknown, bound: NumberBound, copy: FieldCopy, weightUnit: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "has a value Settings can't save";
  if (bound.integer && !Number.isInteger(value)) return "must be a whole number";
  if (bound.minExclusive ? value <= bound.min : value < bound.min) {
    const shown = formatBound(bound.min, copy, weightUnit);
    return bound.minExclusive ? `must be more than ${shown}` : `must be at least ${shown}`;
  }
  if (value > bound.max) return `must be ${formatBound(bound.max, copy, weightUnit)} or less`;
  return null;
}

/**
 * The athlete-facing reason a preferences save would be refused, or null when
 * every numeric field is within the server's range. Other fields are left to
 * the server, whose refusal describePreferencesRejection names.
 * U35 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function describeInvalidPreferences(payload: Readonly<Record<string, unknown>>, weightUnit: string): string | null {
  const values = new Map(Object.entries(payload));
  for (const [field, copy] of FIELD_COPY) {
    const bound = BOUNDS.get(field);
    const rule = bound ? describeRule(values.get(field), bound, copy, weightUnit) : null;
    if (rule) return `${copy.label} ${rule}. ${WHERE}`;
  }
  return null;
}

/** The field a server VALIDATION_ERROR names, from its `details.issues`. */
function rejectedField(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  try {
    const body = JSON.parse(error.message.slice(error.message.indexOf(":") + 1)) as {
      details?: { issues?: { path?: unknown }[] };
    } | null;
    const path = body?.details?.issues?.[0]?.path;
    return typeof path === "string" ? path.split(".", 1).join("") : null;
  } catch {
    return null;
  }
}

/**
 * Copy for a save the server refused as invalid (a bound the client check
 * did not know), naming the field when the response says which; null for any
 * other failure. U35 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function describePreferencesRejection(error: unknown): string | null {
  if (parseApiError(error)?.code !== "VALIDATION_ERROR") return null;
  const copy = FIELD_COPY.get(rejectedField(error) ?? "");
  const subject = copy ? copy.label : "One of your settings";
  return `${subject} has a value Settings can't save. ${WHERE}`;
}
