/**
 * Give existing standalone Strava imports the exercise set they never got.
 *
 * A device import lands as a `workout_logs` row with no `exercise_sets`, and the
 * set-derived half of Analytics — the training-distribution pie, movement-pattern
 * coverage, the muscle heat map, personal records, the progression charts —
 * therefore ignored every one of them, while the overview cards counted them all.
 * The sync now writes that set at import time (services/deviceActivitySets.ts);
 * this backfills the history that was imported before it did.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it writes nothing and prints what it
 * would do.
 *
 * What it will and will not touch:
 *
 *   - Only STANDALONE imports (`device_link_source IS NULL`). A recording that
 *     attached to a session the athlete wrote, or that completed a plan day, is
 *     left alone: those logs' sets are the athlete's, and the rule that a device
 *     never overwrites what they typed holds here too.
 *   - Only logs with NO sets at all. The anti-join is what makes a second run a
 *     no-op, and what stops a set being written twice onto one session — which
 *     would double it in every panel this is meant to fix.
 *   - Only sports the recording actually describes as a set: runs, rides, rows,
 *     swims, walks, hikes, ergs. A "WeightTraining" or "Workout" activity says an
 *     hour happened and nothing about what was in it, and is skipped rather than
 *     invented.
 *
 * Each athlete's rows are stamped with THAT athlete's units, read per athlete by
 * `listBackfillAthletes` — never one operator-supplied unit for the table, which
 * is the corruption the L4 stamp exists to prevent.
 *
 * Reporting goes through `say` (stdout, not the app logger) — see backfillCli.
 *
 * Usage:
 *   pnpm tsx script/backfill-device-activity-sets.ts              # dry run
 *   pnpm tsx script/backfill-device-activity-sets.ts --apply      # write
 *
 * Flags:
 *   --apply          Actually write. Without it, nothing is modified.
 *   --user-id <id>   Restrict to one athlete.
 *   --quiet          Summary only; skip the per-athlete lines.
 */

import {
  backfillDeviceActivitySets,
  listBackfillAthletes,
} from "../server/services/deviceActivitySets";
import { type BackfillFlags, runBackfill, say } from "./backfillCli";

async function main(flags: BackfillFlags): Promise<void> {
  const athletes = await listBackfillAthletes(flags.userId);

  let totalCandidates = 0;
  let totalWritten = 0;
  let athletesTouched = 0;

  for (const athlete of athletes) {
    // The dry run resolves exactly the rows the write would, so "would write N"
    // is the same number `--apply` goes on to write — not an estimate from the
    // candidate count, which is larger (it includes the sports we skip).
    const { candidates, written } = await backfillDeviceActivitySets(athlete, flags.apply);

    totalCandidates += candidates;
    totalWritten += written;
    if (written > 0) athletesTouched++;

    if (!flags.quiet && candidates > 0) {
      const verb = flags.apply ? "wrote" : "would write";
      say(
        `  ${athlete.id}: ${verb} ${written} set(s) from ${candidates} standalone import(s)` +
          ` (${candidates - written} skipped — sport not describable as a set)`,
      );
    }
  }

  say(
    `${flags.apply ? "Backfill complete" : "Dry run (re-run with --apply to write)"}: ` +
      `${totalWritten} set(s) across ${athletesTouched} of ${athletes.length} athlete(s); ` +
      `${totalCandidates} standalone import(s) examined, ${totalCandidates - totalWritten} skipped.`,
  );
}

runBackfill(main);
