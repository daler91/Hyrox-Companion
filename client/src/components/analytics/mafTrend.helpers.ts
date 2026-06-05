import { type MafTestMetrics, metersPerSecond } from "@shared/maf";
import { paceSecondsPerUnit } from "@shared/unitConversion";

import type { MafTestResult, MafTestsListResponse, MafWorkoutAnalysis } from "@/lib/api";

/** Display metadata for the three compliance classifications the server emits. */
export const MAF_CLASSIFICATION_META: Record<string, { label: string; tone: "green" | "amber" | "red" }> = {
  compliant: { label: "Compliant", tone: "green" },
  mostly_compliant: { label: "Mostly compliant", tone: "amber" },
  over_ceiling: { label: "Over ceiling", tone: "red" },
};

export function classificationMeta(classification: string | null): { label: string; tone: "green" | "amber" | "red" } {
  return (classification && MAF_CLASSIFICATION_META[classification]) || { label: classification ?? "Unscored", tone: "amber" };
}

/** `createdAt` arrives as an ISO string over JSON though the row type says Date. */
function isoDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

function createdAtTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export interface CompliancePoint {
  date: string;
  compliancePct: number;
}

/**
 * Compliance % over time, oldest → newest, for the trend line chart. Drops rows
 * without a numeric compliancePct (a test logged with no HR data) or a usable
 * timestamp.
 */
export function buildComplianceTrendData(analysis: readonly MafWorkoutAnalysis[]): CompliancePoint[] {
  return analysis
    .map((a) => ({ date: isoDateOnly(a.createdAt), compliancePct: a.compliancePct }))
    .filter((p): p is CompliancePoint => p.date != null && p.compliancePct != null)
    // ⚡ Bolt Performance Optimization:
    // Replaced expensive `new Date()` parsing inside the sort comparator.
    // Since dates are formatted as YYYY-MM-DD strings, standard string comparison
    // securely orders chronologically without the O(N log N) instantiation overhead.
    .sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });
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
export function isWorkoutTagged(data: MafTestsListResponse | undefined, workoutLogId: string): boolean {
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
 * Pair each test (newest first) with its compliance analysis (matched by
 * workoutLogId) for the history list, surfacing the stored metrics so the UI can
 * show pace, duration, and heart rate alongside the compliance score.
 */
export function buildTestRows(data: MafTestsListResponse | undefined): MafTestRow[] {
  if (!data) return [];
  const analysisByWorkout = new Map<string, MafWorkoutAnalysis>();
  for (const a of data.analysis) {
    if (a.workoutLogId) analysisByWorkout.set(a.workoutLogId, a);
  }
  return [...data.tests]
    .sort((a, b) => createdAtTime(b.createdAt) - createdAtTime(a.createdAt))
    .map((t) => {
      const workoutLogId = testWorkoutLogId(t);
      const analysis = workoutLogId ? analysisByWorkout.get(workoutLogId) : undefined;
      const metrics: Partial<MafTestMetrics> | null = t.metrics ?? null;
      return {
        id: t.id,
        date: isoDateOnly(t.createdAt),
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
  return rows
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
    });
}
