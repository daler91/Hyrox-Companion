/**
 * Report which athletes have `exercise_sets` rows written before the L4 unit
 * stamp, and whether any of them changed unit preference partway through.
 *
 * READ-ONLY. It writes nothing, ever. Its output is the fact that decides what
 * can safely be done with the legacy tail:
 *
 *   - if NO athlete shows a switch, stamping every legacy row with that
 *     athlete's current preference is provably correct rather than an
 *     assumption, and `script/backfill-legacy-unit-rows.ts` closes the tail;
 *   - if some do, those athletes need their history split at the detected
 *     boundary, or a question put to them, and the rest can still be stamped.
 *
 * Why this cannot be answered by reading the schema: a legacy row records no
 * unit, and `users.weight_unit` is a bare scalar with no history — unlike
 * `training_style_previous_id` / `training_style_changed_at` two columns away.
 * The only remaining evidence is the shape of the logged numbers themselves.
 *
 * The verdict itself lives in `server/services/legacyUnitAudit`, not here,
 * because the backfill has to apply the SAME rule this prints. Two copies could
 * drift, and the direction that matters is a backfill stamping an athlete this
 * report would have flagged. The backfill also re-derives it at write time
 * rather than reading `--report-file`: a report from last week cannot know
 * about a switch made yesterday.
 *
 * Usage:
 *   pnpm tsx script/audit-legacy-unit-rows.ts [flags]
 *
 * Flags:
 *   --user-id <id>     Restrict to one athlete.
 *   --report-file <p>  Write the full JSON report to a file.
 *   --quiet            Summary only; skip the per-athlete lines.
 */

import { logger } from "../server/logger";
import {
  type AthleteUnitReport,
  auditAthlete,
  loadAthletes,
} from "../server/services/legacyUnitAudit";

interface Flags {
  userId?: string;
  reportFile?: string;
  quiet: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user-id") flags.userId = argv[++i];
    else if (argv[i] === "--report-file") flags.reportFile = argv[++i];
    else if (argv[i] === "--quiet") flags.quiet = true;
  }
  return flags;
}

/**
 * The per-athlete line, which necessarily carries a user id — a report saying
 * "somebody switched units" is not actionable. `--quiet` suppresses these and
 * leaves only the summary, for a run whose output goes somewhere the ids should
 * not; the full detail is still written to `--report-file`.
 */
function logAthlete(report: AthleteUnitReport): void {
  if (report.verdict === "nothing_to_do") return;
  const detail: Record<string, unknown> = {
    userId: report.userId,
    verdict: report.verdict,
    legacyWeightRows: report.legacyWeightRows,
    legacyDistanceRows: report.legacyDistanceRows,
    currentWeightUnit: report.currentWeightUnit,
  };
  if (report.weightSwitch) {
    detail.weightSwitchOn = report.weightSwitch.onDate;
    detail.weightSwitchDirection = report.weightSwitch.direction;
    detail.evidence = report.weightSwitch.evidence.map(
      (e) => `${e.exercise}: ${e.medianBefore} -> ${e.medianAfter} (x${e.ratio.toFixed(2)})`,
    );
  }
  if (report.distanceSwitch) {
    detail.distanceSwitchOn = report.distanceSwitch.onDate;
    detail.distanceSwitchDirection = report.distanceSwitch.direction;
  }
  if (report.weightPlausibility === "suspect") {
    detail.note = `logged weights do not look like ${report.currentWeightUnit}`;
  }
  logger.info(detail, "[legacy-units] athlete");
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const athletes = await loadAthletes(flags.userId);
  const reports: AthleteUnitReport[] = [];
  for (const athlete of athletes) {
    const report = await auditAthlete(athlete);
    reports.push(report);
    if (!flags.quiet) logAthlete(report);
  }

  const counts = reports.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const legacyRows = reports.reduce((n, r) => n + r.legacyWeightRows + r.legacyDistanceRows, 0);

  // The whole question, as one named boolean: can every legacy row be stamped
  // with its athlete's current preference, or did somebody change units and
  // would a blanket stamp therefore corrupt exactly them?
  const everyAthleteIsSafeToStamp =
    (counts.needs_split ?? 0) === 0 && (counts.needs_review ?? 0) === 0;

  // Counts and a fixed conclusion string only — no athlete identifier and no
  // logged value. Named fields rather than a `...counts` spread, so the log's
  // shape is fixed and greppable instead of depending on which verdicts
  // happened to occur.
  const summary = {
    athletes: reports.length,
    legacyRows,
    safeToStamp: counts.safe_to_stamp ?? 0,
    needsSplit: counts.needs_split ?? 0,
    needsReview: counts.needs_review ?? 0,
    nothingToDo: counts.nothing_to_do ?? 0,
    conclusion: everyAthleteIsSafeToStamp
      ? "No athlete shows a unit switch. Stamping legacy rows with each athlete's current preference is correct, not assumed."
      : "Some athletes changed units mid-history. A blanket stamp would corrupt exactly those, so they need splitting or asking.",
  };

  // Built above and logged on ONE line deliberately: Bearer anchors a
  // multi-line call at its closing parenthesis, so a directive above the
  // opening line does not cover it.
  // bearer:disable javascript_lang_logger_leak
  logger.info(summary, "[legacy-units] summary");

  if (flags.reportFile) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(flags.reportFile, JSON.stringify(reports, null, 2));
    // The operator's own --report-file path, echoed back so they know where the
    // report landed.
    // bearer:disable javascript_lang_logger_leak
    logger.info({ reportFile: flags.reportFile }, "[legacy-units] report written");
  }
}

try {
  await main();
  process.exit(0);
} catch (err) {
  // The operational error that stopped the run, so it can be diagnosed. Same
  // shape the rest of the codebase logs a failure with.
  // bearer:disable javascript_lang_logger_leak
  logger.error({ err }, "[legacy-units] failed");
  process.exit(1);
}
