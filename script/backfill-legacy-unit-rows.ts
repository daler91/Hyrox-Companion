/**
 * Stamp the L4 legacy tail: give every pre-migration `exercise_sets` row the
 * unit it was written in, for the athletes where that is knowable.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it writes nothing and prints what it
 * would do.
 *
 * The rule it enforces, and why the rule is in here rather than in the
 * operator's head:
 *
 *   A legacy row records no unit, and `users.weight_unit` is a bare scalar with
 *   no history, so the write-time unit is unrecoverable from the schema. For an
 *   athlete who never changed units it is nonetheless known — it is the unit
 *   they still use. For an athlete who DID change, stamping the current
 *   preference is wrong by ~2.2x on everything logged before the switch, which
 *   is worse than leaving the rows unstamped: an unstamped row is visibly
 *   unknown, a wrongly-stamped one is confidently wrong.
 *
 * So this re-runs the detector itself, per athlete, immediately before writing,
 * and touches only the athletes it clears. It deliberately does NOT read the
 * report file: a report generated last week cannot know about a switch made
 * yesterday, and a stale "safe_to_stamp" is exactly the input that would corrupt
 * the athlete this whole exercise exists to protect.
 *
 * Idempotent. It only ever touches rows whose unit column IS NULL, so a second
 * run finds nothing left to do. Safe to re-run after resolving a `needs_split`.
 *
 * Usage:
 *   pnpm tsx script/backfill-legacy-unit-rows.ts              # dry run
 *   pnpm tsx script/backfill-legacy-unit-rows.ts --apply      # write
 *
 * Flags:
 *   --apply          Actually write. Without it, nothing is modified.
 *   --user-id <id>   Restrict to one athlete.
 *   --quiet          Summary only; skip the per-athlete lines.
 */

import { stampForPreferences } from "@shared/unitConversion";

import { logger } from "../server/logger";
import {
  type AthleteUnitReport,
  type AthleteUnitRow,
  auditAthlete,
  isSafeToStamp,
  loadAthletes,
} from "../server/services/legacyUnitAudit";
import { countUnstamped, stampLegacyRowsForUser } from "../server/services/legacyUnitBackfill";

interface Flags {
  apply: boolean;
  userId?: string;
  quiet: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { apply: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") flags.apply = true;
    else if (argv[i] === "--user-id") flags.userId = argv[++i];
    else if (argv[i] === "--quiet") flags.quiet = true;
  }
  return flags;
}

interface StampPlan {
  readonly report: AthleteUnitReport;
  readonly weightRows: number;
  readonly distanceRows: number;
  readonly weightUnit: string;
  readonly distanceUnit: string;
}

/**
 * What stamping this athlete would touch.
 *
 * Counted over NULL unit columns rather than over the detector's measurement
 * counts, which are deliberately narrower: the detector ignores rows with no
 * positive value because they carry no signal, but those rows still need a
 * stamp. So a plan can legitimately cover more rows than the report's
 * `legacyWeightRows`.
 */
async function planFor(report: AthleteUnitReport): Promise<StampPlan> {
  const stamp = stampForPreferences({
    weightUnit: report.currentWeightUnit,
    distanceUnit: report.currentDistanceUnit,
  });
  const [weightRows, distanceRows] = await Promise.all([
    countUnstamped(report.userId, "weight"),
    countUnstamped(report.userId, "distance"),
  ]);
  return {
    report,
    weightRows,
    distanceRows,
    weightUnit: stamp.weightUnit,
    distanceUnit: stamp.distanceUnit,
  };
}

function logSkip(report: AthleteUnitReport): void {
  const detail: Record<string, unknown> = { userId: report.userId, verdict: report.verdict };
  if (report.weightSwitch) detail.weightSwitchOn = report.weightSwitch.onDate;
  if (report.distanceSwitch) detail.distanceSwitchOn = report.distanceSwitch.onDate;
  // A skipped athlete is the whole point of the interlock, so their id is the
  // actionable part of the line — somebody has to go and resolve them.
  // bearer:disable javascript_lang_logger_leak
  logger.warn(detail, "[legacy-units] SKIPPED — not safe to stamp");
}

function logStamp(plan: StampPlan, applied: boolean): void {
  const detail = {
    userId: plan.report.userId,
    weightRows: plan.weightRows,
    distanceRows: plan.distanceRows,
    weightUnit: plan.weightUnit,
    distanceUnit: plan.distanceUnit,
    applied,
  };
  // The athlete being stamped and the unit stamped on them — the audit trail
  // for a write, which is why the id belongs in it.
  // bearer:disable javascript_lang_logger_leak
  logger.info(detail, applied ? "[legacy-units] stamped" : "[legacy-units] would stamp");
}

/** What happened to one athlete. Kept as a value rather than folded into the
 *  loop so the decision and the tally can each be read on their own. */
type Outcome =
  | { readonly kind: "nothing_to_do" }
  | { readonly kind: "skipped" }
  | { readonly kind: "stamped"; readonly weightRows: number; readonly distanceRows: number };

/**
 * The whole decision for one athlete, from evidence to write.
 *
 * The audit runs HERE, inside the per-athlete step, so the gate is evaluated
 * against the database as it is at the moment of writing rather than against a
 * report file. See the header.
 */
async function processAthlete(athlete: AthleteUnitRow, flags: Flags): Promise<Outcome> {
  const report = await auditAthlete(athlete);
  if (report.verdict === "nothing_to_do") return { kind: "nothing_to_do" };

  if (!isSafeToStamp(report)) {
    if (!flags.quiet) logSkip(report);
    return { kind: "skipped" };
  }

  const plan = await planFor(report);
  // The detector counts only rows with a positive value; the stamp covers every
  // NULL unit column. An athlete can therefore clear the gate and still have no
  // columns left to fill — already stamped by an earlier run.
  if (plan.weightRows === 0 && plan.distanceRows === 0) return { kind: "nothing_to_do" };

  if (flags.apply) await stampLegacyRowsForUser(plan.report.userId, plan);
  if (!flags.quiet) logStamp(plan, flags.apply);
  return { kind: "stamped", weightRows: plan.weightRows, distanceRows: plan.distanceRows };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const athletes = await loadAthletes(flags.userId);
  const tally = { stamped: 0, weightRows: 0, distanceRows: 0, skipped: 0, nothingToDo: 0 };

  for (const athlete of athletes) {
    const outcome = await processAthlete(athlete, flags);
    if (outcome.kind === "skipped") tally.skipped++;
    else if (outcome.kind === "nothing_to_do") tally.nothingToDo++;
    else {
      tally.stamped++;
      tally.weightRows += outcome.weightRows;
      tally.distanceRows += outcome.distanceRows;
    }
  }

  const summary = {
    mode: flags.apply ? "APPLIED" : "DRY RUN — nothing written",
    athletesConsidered: athletes.length,
    athletesStamped: tally.stamped,
    weightRows: tally.weightRows,
    distanceRows: tally.distanceRows,
    athletesSkipped: tally.skipped,
    athletesWithNothingToDo: tally.nothingToDo,
    note:
      tally.skipped > 0
        ? "Some athletes were skipped: their history shows a unit switch, or their weights do not look like the unit they claim. Those need splitting or asking before their rows can be stamped."
        : "Every athlete with legacy rows was cleared by the detector.",
  };

  // Counts and fixed strings only — no athlete identifier. Built above and
  // logged on ONE line deliberately: Bearer anchors a multi-line call at its
  // closing parenthesis, so a directive above the opening line does not cover it.
  // bearer:disable javascript_lang_logger_leak
  logger.info(summary, "[legacy-units] backfill summary");
}

try {
  await main();
  process.exit(0);
} catch (err) {
  // The operational error that stopped the run, so it can be diagnosed. Same
  // shape the rest of the codebase logs a failure with.
  // bearer:disable javascript_lang_logger_leak
  logger.error({ err }, "[legacy-units] backfill failed");
  process.exit(1);
}
