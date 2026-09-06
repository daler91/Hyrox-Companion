import type { MafTrendSummary } from "../../gemini/types";
import type { MafTestResult, MafWorkoutAnalysis } from "../../storage/mafTests";

const DAY_MS = 24 * 60 * 60 * 1000;

// Compliance is "how well the test held the MAF ceiling" (higher = better), so
// a rising percentage over time is an improving trend. Require a few points of
// movement before calling a direction so noise between tests reads as "flat".
const COMPLIANCE_TREND_THRESHOLD_PCT = 5;

/**
 * How far back the compliance trend looks for its baseline.
 *
 * The baseline used to be "the oldest analysis in whatever rows were fetched",
 * and the fetch defaulted to the newest 20 — so the reference point slid forward
 * every time the athlete logged another test. Someone who improved sharply and
 * then held steady watched "improving" decay to "flat" with no change in their
 * training, purely because the early tests fell out of the window (audit M14).
 *
 * A trend has to be anchored to TIME, not to a row count. Six months is the
 * policy choice: MAF tests are typically repeated every four to six weeks, so a
 * 90-day window would yield only two or three points to trend across — thin for
 * a comparison that already needs 5 percentage points of movement before it
 * calls a direction. Half a year gives four to six and is still recognisably
 * "recent". Comparing against the athlete's all-time first test would be equally
 * stable, but would keep crediting a beginner's first month years later.
 */
const COMPLIANCE_BASELINE_DAYS = 180;

/**
 * Summarize an athlete's MAF test history into the compact trend the coaching
 * context carries. `tests` and `analyses` are the user's rows (any order); the
 * summary is cadence + compliance based — see {@link MafTrendSummary}.
 */
export function summarizeMafTrend(
  tests: MafTestResult[],
  analyses: MafWorkoutAnalysis[],
  now: Date = new Date(),
  opts: {
    /**
     * The athlete's true lifetime test count. `tests` is a bounded fetch, so
     * counting it reported "20 tests" to anyone who had logged more than twenty
     * (audit M14). Omitted, the array length is used, which keeps existing
     * callers unchanged.
     */
    readonly totalTestCount?: number;
  } = {},
): MafTrendSummary {
  const lastTestAt = tests.reduce<Date | null>((latest, t) => {
    if (!t.createdAt) return latest;
    // ⚡ Bolt Performance Optimization:
    // `createdAt` is already a Date. Avoid allocating new Date objects here.
    const d = t.createdAt;
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

  // Oldest analysis inside a fixed trailing window, not `scored[0]` — see
  // COMPLIANCE_BASELINE_DAYS for why the row-position baseline was wrong.
  const baselineCutoff = now.getTime() - COMPLIANCE_BASELINE_DAYS * DAY_MS;
  const inWindow = scored.filter((a) => a.createdAt.getTime() >= baselineCutoff);

  let complianceTrend: MafTrendSummary["complianceTrend"] = "insufficient_data";
  if (latest && inWindow.length >= 2) {
    const delta = latest.compliancePct - inWindow[0].compliancePct;
    if (delta > COMPLIANCE_TREND_THRESHOLD_PCT) complianceTrend = "improving";
    else if (delta < -COMPLIANCE_TREND_THRESHOLD_PCT) complianceTrend = "declining";
    else complianceTrend = "flat";
  }

  return {
    testCount: opts.totalTestCount ?? tests.length,
    lastTestDaysAgo,
    latestClassification,
    latestCompliancePct,
    complianceTrend,
  };
}
