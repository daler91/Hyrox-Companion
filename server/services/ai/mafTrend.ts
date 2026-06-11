import type { MafTrendSummary } from "../../gemini/types";
import type { MafTestResult, MafWorkoutAnalysis } from "../../storage/mafTests";

const DAY_MS = 24 * 60 * 60 * 1000;

// Compliance is "how well the test held the MAF ceiling" (higher = better), so
// a rising percentage over time is an improving trend. Require a few points of
// movement before calling a direction so noise between tests reads as "flat".
const COMPLIANCE_TREND_THRESHOLD_PCT = 5;

/**
 * Summarize an athlete's MAF test history into the compact trend the coaching
 * context carries. `tests` and `analyses` are the user's rows (any order); the
 * summary is cadence + compliance based — see {@link MafTrendSummary}.
 */
export function summarizeMafTrend(
  tests: MafTestResult[],
  analyses: MafWorkoutAnalysis[],
  now: Date = new Date(),
): MafTrendSummary {
  const lastTestAt = tests.reduce<Date | null>((latest, t) => {
    if (!t.createdAt) return latest;
    const d = new Date(t.createdAt);
    return latest == null || d > latest ? d : latest;
  }, null);

  const lastTestDaysAgo =
    lastTestAt == null
      ? null
      : Math.max(0, Math.floor((now.getTime() - lastTestAt.getTime()) / DAY_MS));

  // Oldest → newest, keeping only analyses we can score.
  const scored = analyses
    .filter((a): a is MafWorkoutAnalysis & { compliancePct: number; createdAt: Date } =>
      a.compliancePct != null && a.createdAt != null,
    )
    // ⚡ Bolt Performance Optimization:
    // Replaced expensive `new Date()` parsing inside the sort comparator.
    // The `createdAt` field on the filtered items is strictly typed as a Date object.
    // Calling `getTime()` directly avoids O(N log N) instantiation overhead during sorting.
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const latest = scored.at(-1) ?? null;
  const latestCompliancePct = latest?.compliancePct ?? null;
  const latestClassification =
    (latest?.classification as MafTrendSummary["latestClassification"]) ?? null;

  let complianceTrend: MafTrendSummary["complianceTrend"] = "insufficient_data";
  if (latest && scored.length >= 2) {
    const delta = latest.compliancePct - scored[0].compliancePct;
    if (delta > COMPLIANCE_TREND_THRESHOLD_PCT) complianceTrend = "improving";
    else if (delta < -COMPLIANCE_TREND_THRESHOLD_PCT) complianceTrend = "declining";
    else complianceTrend = "flat";
  }

  return {
    testCount: tests.length,
    lastTestDaysAgo,
    latestClassification,
    latestCompliancePct,
    complianceTrend,
  };
}
