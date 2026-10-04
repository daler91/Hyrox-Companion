import { type MafTestMetrics, metersPerSecond } from "@shared/maf";
import { paceSecondsPerUnit } from "@shared/unitConversion";

import type { MafTestResult, MafTestsListResponse, MafWorkoutAnalysis } from "@/lib/api";
import { toISODateString } from "@/lib/dateUtils";

/** Display metadata for the three compliance classifications the server emits. */
export const MAF_CLASSIFICATION_META: Record<
  string,
  { label: string; tone: "green" | "amber" | "red" }
> = {
  compliant: { label: "Compliant", tone: "green" },
  mostly_compliant: { label: "Mostly compliant", tone: "amber" },
  over_ceiling: { label: "Over ceiling", tone: "red" },
};

export function classificationMeta(classification: string | null): {
  label: string;
  tone: "green" | "amber" | "red";
} {
  return (
    (classification && MAF_CLASSIFICATION_META[classification]) || {
      label: classification ?? "Unscored",
      tone: "amber",
    }
  );
}

/** A row timestamp: `createdAt` arrives as an ISO string over JSON though the row type says Date. */
type RowTimestamp = string | Date | null | undefined;

/** The LOCAL calendar day of a timestamp. */
function localDateOnly(value: RowTimestamp): string | null {
  if (!value) return null;
  // ⚡ Bolt Performance Optimization:
  // Use Date.parse() instead of new Date().getTime() to prevent intermediate object allocation
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (Number.isNaN(time)) return null;
  return toISODateString(new Date(time));
}

/**
 * The day a test belongs to: its workout's own date. `createdAt` is only when
 * the athlete TAGGED the run, so older runs tagged together all landed on the
 * tag day, and slicing its ISO string took that day in UTC (CL4
 * (CODEBASE_ANALYSIS_2026-10-03)). The local tag day remains the fallback for a
 * deleted workout or a cached response from before the server sent dates.
 */
function testDate(
  workoutLogId: string | null,
  createdAt: RowTimestamp,
  workoutDates: ReadonlyMap<string, string>,
): string | null {
  const workoutDate = workoutLogId ? workoutDates.get(workoutLogId) : undefined;
  return typeof workoutDate === "string" ? workoutDate : localDateOnly(createdAt);
}

/** The response's workout dates by workout id, read through a Map rather than by indexing the object. */
function workoutDateIndex(workoutDates: MafTestsListResponse["workoutDates"]): ReadonlyMap<string, string> {
  return new Map(Object.entries(workoutDates ?? {}));
}

/** Newest YYYY-MM-DD first; undated last. */
function compareDateDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

function createdAtTime(value: RowTimestamp): number {
  if (!value) return 0;
  // ⚡ Bolt Performance Optimization:
  // Use Date.parse() instead of new Date().getTime() to prevent intermediate object allocation
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isNaN(time) ? 0 : time;
}

export interface CompliancePoint {
  date: string;
  compliancePct: number;
}

/**
 * Compliance % over time, oldest → newest, for the trend line chart, dated by
 * each test's workout. Drops rows without a numeric compliancePct (a test
 * logged with no HR data) or a usable date.
 */
export function buildComplianceTrendData(
  analysis: readonly MafWorkoutAnalysis[],
  workoutDates?: MafTestsListResponse["workoutDates"],
): CompliancePoint[] {
  const datesById = workoutDateIndex(workoutDates);
  return (
    analysis
      .map((a) => ({
        date: testDate(a.workoutLogId, a.createdAt, datesById),
        compliancePct: a.compliancePct,
      }))
      .filter((p): p is CompliancePoint => p.date != null && p.compliancePct != null)
      // ⚡ Bolt Performance Optimization:
      // Replaced expensive `new Date()` parsing inside the sort comparator.
      // Since dates are formatted as YYYY-MM-DD strings, standard string comparison
      // securely orders chronologically without the O(N log N) instantiation overhead.
      .sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
      })
  );
}

/** The `workoutLogId` a test row carries inside its `conditions` JSONB, if any. */
export function testWorkoutLogId(test: MafTestResult): string | null {
  const conditions = test.conditions as { workoutLogId?: string } | null;
  return conditions?.workoutLogId ?? null;
}

/**
 * Whether a given workout is already tagged as a MAF test. Checks both the
 * analysis rows (HR present → scored) and the test rows' conditions (a test
 * logged without HR has no analysis row).
 */
export function isWorkoutTagged(
  data: MafTestsListResponse | undefined,
  workoutLogId: string,
): boolean {
  if (!data) return false;
  if (data.analysis.some((a) => a.workoutLogId === workoutLogId)) return true;
  return data.tests.some((t) => testWorkoutLogId(t) === workoutLogId);
}

export interface MafTestRow {
  id: string;
  date: string | null;
  compliancePct: number | null;
  classification: string | null;
  protocolType: string;
  /** Snapshot metrics (canonical seconds/meters/bpm), for pace + duration display. */
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgHeartRate: number | null;
}

/**
 * Pair each test (newest workout first) with its compliance analysis (matched
 * by workoutLogId) for the history list, surfacing the stored metrics so the UI
 * can show pace, duration, and heart rate alongside the compliance score.
 */
export function buildTestRows(data: MafTestsListResponse | undefined): MafTestRow[] {
  if (!data) return [];
  const analysisByWorkout = new Map<string, MafWorkoutAnalysis>();
  for (const a of data.analysis) {
    if (a.workoutLogId) analysisByWorkout.set(a.workoutLogId, a);
  }
  const datesById = workoutDateIndex(data.workoutDates);
  return data.tests
    .map((t) => {
      const workoutLogId = testWorkoutLogId(t);
      return { t, workoutLogId, date: testDate(workoutLogId, t.createdAt, datesById) };
    })
    // Same-day tests fall back to the order they were tagged in.
    .sort(
      (a, b) =>
        compareDateDesc(a.date, b.date) || createdAtTime(b.t.createdAt) - createdAtTime(a.t.createdAt),
    )
    .map(({ t, workoutLogId, date }) => {
      const analysis = workoutLogId ? analysisByWorkout.get(workoutLogId) : undefined;
      const metrics: Partial<MafTestMetrics> | null = t.metrics ?? null;
      return {
        id: t.id,
        date,
        compliancePct: analysis?.compliancePct ?? null,
        classification: analysis?.classification ?? null,
        protocolType: t.protocolType,
        durationSeconds: metrics?.durationSeconds ?? null,
        distanceMeters: metrics?.distanceMeters ?? null,
        avgHeartRate: metrics?.avgHeartRate ?? null,
      };
    });
}

export interface PacePoint {
  date: string;
  secondsPerUnit: number;
}

/**
 * Pace (seconds per the athlete's distance unit) over time, oldest → newest, for
 * the pace trend chart. Derived from each test's stored distance + duration;
 * drops rows without a usable pace or timestamp. Lower is faster — the whole
 * point of MAF testing is watching this fall while heart rate stays fixed.
 */
export function buildPaceTrendData(rows: readonly MafTestRow[], distanceUnit: string): PacePoint[] {
  return (
    rows
      .map((row) => {
        const mps = metersPerSecond(row.distanceMeters, row.durationSeconds);
        const secondsPerUnit = mps == null ? null : paceSecondsPerUnit(mps, distanceUnit);
        if (secondsPerUnit == null || row.date == null) return null;
        return { date: row.date, secondsPerUnit };
      })
      .filter((p): p is PacePoint => p !== null)
      // ⚡ Bolt Performance Optimization:
      // Replaced expensive `new Date()` parsing inside the sort comparator.
      // Since dates are formatted as YYYY-MM-DD strings, standard string comparison
      // securely orders chronologically without the O(N log N) instantiation overhead.
      .sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
      })
  );
}
