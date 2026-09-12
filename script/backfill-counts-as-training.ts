/**
 * Mark existing device imports that are not training as not training.
 *
 * `counts_as_training` arrived with `DEFAULT true`, so the migration left every
 * historical row — including every dog walk, commute and yoga class a watch
 * ever synced — counting toward "Total Workouts", "Avg / Week", the streak and
 * the training mix. New imports are stamped at sync time from the sport type
 * (shared/deviceSportTypes.ts); this applies the same rule to the history.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it writes nothing and prints what it
 * would do.
 *
 * What it will and will not touch:
 *
 *   - Only rows with a provider sport to read: a Strava snapshot's
 *     `sport_type`, a Garmin one's `activityType.typeKey`, else the log's
 *     `focus` (which both mappers set from the sport type, so pre-snapshot
 *     imports still classify). A manual log has no provider sport and is never
 *     touched — the athlete typed it, they meant it.
 *   - Only rows the deny-list says are not training. Nothing is ever flipped
 *     back ON: an athlete who has already turned a walk into training keeps
 *     that, because re-deriving would overwrite their decision, which is the
 *     one thing the column promises not to do.
 *   - Only rows still at the migration's default. Re-running finds nothing.
 *
 * Expect Total Workouts and Avg / Week to fall and Avg Duration to rise once
 * this runs. That is the point, but it looks like a regression if you are not
 * expecting it.
 *
 * Usage:
 *   pnpm tsx script/backfill-counts-as-training.ts              # dry run
 *   pnpm tsx script/backfill-counts-as-training.ts --apply      # write
 *
 * Flags:
 *   --apply          Actually write. Without it, nothing is modified.
 *   --user-id <id>   Restrict to one athlete.
 *   --quiet          Summary only; skip the per-sport lines.
 */

import { countsAsTraining } from "@shared/deviceSportTypes";
import { workoutLogs } from "@shared/schema";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db } from "../server/db";
import { type BackfillFlags, runBackfill, say } from "./backfillCli";

/** The provider's own sport for a row, or null when there is nothing to read. */
function sportTypeOf(log: {
  focus: string;
  deviceActivity: { raw?: { sport_type?: string; type?: string } } | null;
}): string | null {
  const raw = log.deviceActivity?.raw;
  return raw?.sport_type || raw?.type || log.focus || null;
}

async function main(flags: BackfillFlags): Promise<void> {
  // Device rows only, and only those still at the default. A row already set
  // false needs nothing; a row an athlete set is not ours to revisit.
  const conditions = [
    eq(workoutLogs.countsAsTraining, true),
    or(isNotNull(workoutLogs.stravaActivityId), isNotNull(workoutLogs.garminActivityId)),
  ];
  if (flags.userId) conditions.push(eq(workoutLogs.userId, flags.userId));

  const rows = await db
    .select({
      id: workoutLogs.id,
      focus: workoutLogs.focus,
      deviceActivity: workoutLogs.deviceActivity,
    })
    .from(workoutLogs)
    .where(and(...conditions));

  const demoteIds: string[] = [];
  const bySport = new Map<string, number>();
  for (const row of rows) {
    const sport = sportTypeOf(row);
    if (!sport || countsAsTraining(sport)) continue;
    demoteIds.push(row.id);
    bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
  }

  if (!flags.quiet) {
    for (const [sport, count] of [...bySport].sort((a, b) => b[1] - a[1])) {
      say(`  ${sport}: ${count}`);
    }
  }

  if (flags.apply && demoteIds.length > 0) {
    // Chunked: a single IN list of tens of thousands of ids is a query no
    // planner enjoys, and the backfill has no reason to be one statement.
    const CHUNK = 500;
    for (let i = 0; i < demoteIds.length; i += CHUNK) {
      await db
        .update(workoutLogs)
        .set({ countsAsTraining: false })
        .where(inArray(workoutLogs.id, demoteIds.slice(i, i + CHUNK)));
    }
  }

  say(
    `${flags.apply ? "Backfill complete" : "Dry run (re-run with --apply to write)"}: ` +
      `${demoteIds.length} of ${rows.length} device import(s) no longer count as training.`,
  );
}

runBackfill(main);
