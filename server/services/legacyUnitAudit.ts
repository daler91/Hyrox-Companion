/**
 * Per-athlete verdicts on the L4 legacy tail: which athletes' unit-less
 * `exercise_sets` rows can safely be stamped with their current preference, and
 * which cannot.
 *
 * This lives here rather than in the reporting script because TWO callers need
 * it and they must not drift: `script/audit-legacy-unit-rows.ts` prints the
 * verdict, and `script/backfill-legacy-unit-rows.ts` acts on it. A backfill that
 * re-derived "is this athlete safe?" from its own copy of the rule — or worse,
 * trusted a JSON file written days earlier against different data — could stamp
 * an athlete the report had cleared before they switched units. The gate is the
 * same function, evaluated against the database as it is at write time.
 *
 * Reading only. Nothing here writes.
 */

import { exerciseSets, users, workoutLogs } from "@shared/schema";
import { standardizeWeightUnit } from "@shared/unitConversion";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import {
  describeUnitPlausibility,
  detectDistanceUnitSwitch,
  type DetectedSwitch,
  detectWeightUnitSwitch,
  type LoggedMeasurement,
  type UnitPlausibility,
} from "./unitSwitchDetection";

/** What a stamp-with-current-preference backfill would do to one athlete. */
export type LegacyUnitVerdict =
  /** No evidence of a switch: stamping is correct, not assumed. */
  | "safe_to_stamp"
  /** A switch was found. A blanket stamp would corrupt exactly this athlete. */
  | "needs_split"
  /** No boundary found, but the numbers do not look like the claimed unit. */
  | "needs_review"
  /** No legacy rows at all. */
  | "nothing_to_do";

export interface AthleteUnitReport {
  readonly userId: string;
  readonly currentWeightUnit: string;
  readonly currentDistanceUnit: string;
  readonly legacyWeightRows: number;
  readonly legacyDistanceRows: number;
  readonly weightSwitch: DetectedSwitch | null;
  readonly distanceSwitch: DetectedSwitch | null;
  readonly weightPlausibility: UnitPlausibility;
  readonly verdict: LegacyUnitVerdict;
}

export interface AthleteUnitRow {
  readonly id: string;
  readonly weightUnit: string | null;
  readonly distanceUnit: string | null;
}

/**
 * Legacy rows only — `weight_unit IS NULL` is exactly "written before the L4
 * migration". Stamped rows already say what they are and are none of this
 * module's business.
 */
async function loadLegacyMeasurements(
  userId: string,
  column: "weight" | "distance",
): Promise<LoggedMeasurement[]> {
  const unitColumn = column === "weight" ? exerciseSets.weightUnit : exerciseSets.distanceUnit;
  const valueColumn = column === "weight" ? exerciseSets.weight : exerciseSets.distance;

  const rows = await db
    .select({
      date: workoutLogs.date,
      exerciseName: exerciseSets.exerciseName,
      customLabel: exerciseSets.customLabel,
      value: valueColumn,
    })
    .from(exerciseSets)
    .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
    .where(and(eq(workoutLogs.userId, userId), isNull(unitColumn), sql`${valueColumn} > 0`));

  return rows.map((r) => ({
    date: r.date,
    // Same key analytics uses, so a custom "Sled Push" is not merged with the
    // catalogue exercises (audit H4 is the same distinction).
    exercise:
      r.exerciseName === "custom" && r.customLabel ? `custom:${r.customLabel}` : r.exerciseName,
    value: Number(r.value),
  }));
}

/**
 * The gate, as one pure function of the evidence.
 *
 * Order matters: a detected switch outranks the plausibility band, because a
 * boundary is direct evidence and the band is a weak heuristic. An athlete who
 * trips both is `needs_split` — the stronger, more actionable verdict.
 */
export function verdictFor(evidence: {
  readonly legacyWeightRows: number;
  readonly legacyDistanceRows: number;
  readonly weightSwitch: DetectedSwitch | null;
  readonly distanceSwitch: DetectedSwitch | null;
  readonly weightPlausibility: UnitPlausibility;
}): LegacyUnitVerdict {
  if (evidence.legacyWeightRows === 0 && evidence.legacyDistanceRows === 0) return "nothing_to_do";
  if (evidence.weightSwitch || evidence.distanceSwitch) return "needs_split";
  if (evidence.weightPlausibility === "suspect") return "needs_review";
  return "safe_to_stamp";
}

/** The one athlete a backfill is allowed to touch. Nothing else. */
export function isSafeToStamp(report: AthleteUnitReport): boolean {
  return report.verdict === "safe_to_stamp";
}

export async function auditAthlete(user: AthleteUnitRow): Promise<AthleteUnitReport> {
  const [weights, distances] = await Promise.all([
    loadLegacyMeasurements(user.id, "weight"),
    loadLegacyMeasurements(user.id, "distance"),
  ]);

  const evidence = {
    legacyWeightRows: weights.length,
    legacyDistanceRows: distances.length,
    weightSwitch: detectWeightUnitSwitch(weights),
    distanceSwitch: detectDistanceUnitSwitch(distances),
    weightPlausibility: describeUnitPlausibility(
      weights.map((w) => w.value),
      standardizeWeightUnit(user.weightUnit),
    ),
  };

  return {
    userId: user.id,
    currentWeightUnit: user.weightUnit ?? "kg",
    currentDistanceUnit: user.distanceUnit ?? "km",
    ...evidence,
    verdict: verdictFor(evidence),
  };
}

export async function loadAthletes(userId?: string): Promise<AthleteUnitRow[]> {
  return db
    .select({ id: users.id, weightUnit: users.weightUnit, distanceUnit: users.distanceUnit })
    .from(users)
    .where(userId ? eq(users.id, userId) : undefined);
}
