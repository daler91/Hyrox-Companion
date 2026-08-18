import type { TrainingContext } from "../gemini/types";

/**
 * Shared renderer for the MAF METHOD block: the aerobic ceiling and the test
 * cadence/compliance summary for athletes on the MAF training style.
 *
 * `mafHr` and `mafTrend` sat on `TrainingContext` rendered by NEITHER prompt
 * assembler — the exact drift the coach-memory spec (§4) used as its
 * cautionary tale. `summarizeMafTrend` was costing MAF athletes two DB reads
 * on every coach turn to feed nothing. Used by BOTH buildSystemPrompt and
 * buildPromptDataSections, like formatAthleteConstraints, so the two paths
 * cannot drift apart again.
 *
 * Gated on `mafTrend`, which buildTrainingContext sets only for athletes whose
 * CURRENT training style is maf_method — `mafHr` alone can linger on the
 * profile after switching styles, and coaching an ex-MAF athlete to a ceiling
 * they left behind would be wrong.
 */

const CLASSIFICATION_LABELS: Record<string, string> = {
  compliant: "compliant",
  mostly_compliant: "mostly compliant",
  over_ceiling: "over the ceiling",
};

/** A monthly retest keeps the ceiling calibrated; nudge past this. */
const TEST_CADENCE_NUDGE_DAYS = 28;

export function formatMafContext(context: TrainingContext): string {
  const { mafHr, mafTrend } = context;
  if (!mafTrend) return "";

  const lines: string[] = [`--- MAF METHOD ---`];
  if (mafHr) {
    lines.push(
      `Aerobic ceiling: ${mafHr} bpm. Prescribed easy/aerobic work must stay at or under this — do not prescribe heart-rate targets above it.`,
    );
  }

  if (mafTrend.testCount === 0) {
    lines.push(`No MAF tests logged yet — suggest a baseline test to calibrate the ceiling.`);
  } else {
    let testLine = `MAF tests: ${mafTrend.testCount} logged`;
    if (mafTrend.lastTestDaysAgo != null) testLine += `, last ${mafTrend.lastTestDaysAgo} days ago`;
    if (mafTrend.latestClassification) {
      testLine += `; latest ${CLASSIFICATION_LABELS[mafTrend.latestClassification] ?? mafTrend.latestClassification}`;
      if (mafTrend.latestCompliancePct != null) testLine += ` (${mafTrend.latestCompliancePct}% under ceiling)`;
    }
    if (mafTrend.complianceTrend !== "insufficient_data") {
      testLine += `; compliance trend ${mafTrend.complianceTrend}`;
    }
    lines.push(`${testLine}.`);
    if (mafTrend.lastTestDaysAgo != null && mafTrend.lastTestDaysAgo > TEST_CADENCE_NUDGE_DAYS) {
      lines.push(
        `The last test is over ${TEST_CADENCE_NUDGE_DAYS} days old — suggest a retest to keep the ceiling calibrated.`,
      );
    }
  }

  return lines.join("\n");
}
