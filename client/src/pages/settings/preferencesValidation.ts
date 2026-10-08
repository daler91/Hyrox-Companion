import { updateUserPreferencesSchema } from "@shared/schema";
import { kgToUserWeight } from "@shared/unitConversion";

import { parseApiError } from "@/lib/apiError";

/**
 * Settings has one Save bar for every tab, and the server refuses the whole
 * PATCH when any one value is out of range: a resting HR of 25 or a weekly
 * rate of 5 lbs left every later save failing with "Please try again" and
 * nothing pointing at the field. The payload is checked here against the same
 * shared schema the server validates with, and the refusal names the field,
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

const WHERE = "Fix it on the Training tab, then save again.";

/** A bound in the units the field is shown in, rounded for display. */
function formatBound(bound: number, copy: FieldCopy, weightUnit: string): string {
  if (copy.weight) {
    const shown = Math.round(kgToUserWeight(bound, weightUnit) * 10) / 10;
    return `${String(shown)} ${weightUnit}`;
  }
  return copy.unit ? `${String(bound)} ${copy.unit}` : String(bound);
}

interface RangeIssue {
  readonly code: string;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
  readonly inclusive?: boolean;
}

/** What is wrong with the value, e.g. "must be at least 30 bpm". */
function describeRule(issue: RangeIssue, copy: FieldCopy, weightUnit: string): string {
  if (issue.code === "too_big" && typeof issue.maximum === "number") {
    return `must be ${formatBound(issue.maximum, copy, weightUnit)} or less`;
  }
  if (issue.code === "too_small" && typeof issue.minimum === "number") {
    return issue.inclusive === false
      ? `must be more than ${formatBound(issue.minimum, copy, weightUnit)}`
      : `must be at least ${formatBound(issue.minimum, copy, weightUnit)}`;
  }
  // zod reports a fraction where `.int()` wants a whole number as invalid_type.
  if (issue.code === "invalid_type") return "must be a whole number";
  return "has a value Settings can't save";
}

/**
 * The athlete-facing reason a preferences save would be refused, or null when
 * the server's schema accepts it. U35 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function describeInvalidPreferences(payload: unknown, weightUnit: string): string | null {
  const result = updateUserPreferencesSchema.safeParse(payload);
  if (result.success) return null;
  const issue = result.error.issues[0];
  const copy = FIELD_COPY.get(String(issue?.path[0] ?? ""));
  if (!issue || !copy) return `One of your settings has a value Settings can't save. ${WHERE}`;
  return `${copy.label} ${describeRule(issue, copy, weightUnit)}. ${WHERE}`;
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
