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
 * What it will and will not touch (D5, CODEBASE_ANALYSIS_2026-10-03 — the
 * first version demoted every device-id row, athlete-owned ones included):
 *
 *   - Only standalone imports the sync created and nobody has adopted since:
 *     a Strava or Garmin id, `source` still "strava"/"garmin", no plan day and
 *     no device link. A manual log a recording was linked to, a plan day's log
 *     (whoever linked it), and an import the athlete moved onto a plan day are
 *     the athlete's sessions and are never touched — they typed or chose them,
 *     they meant them.
 *   - Only imports from before the sync started stamping the column
 *     (STAMPED_AT_SYNC_SINCE). Every later import was stamped false at sync if
 *     its sport is on the deny-list, so one still counting is the athlete's own
 *     switch back on. The import instant is the snapshot's `linkedAt` (Strava
 *     since 2026-09-07); a row without a snapshot (older Strava, every Garmin)
 *     goes by its activity date, since a session dated after the release can
 *     only have been imported after it.
 *   - Only rows with a provider sport to read: a Strava snapshot's
 *     `sport_type`, else the log's `focus` (which both mappers set from the
 *     sport type, so pre-snapshot and Garmin imports still classify).
 *   - Only rows the deny-list says are not training. Nothing is ever flipped
 *     back ON by the backfill itself.
 *   - Only rows still at the migration's default. Re-running finds nothing.
 *
 * What it cannot tell apart, because nothing records the toggle: an older
 * import the athlete switched off and back on, or a Garmin import of an older
 * session synced after the release and then switched on. Those are why every
 * flip is recorded: `--apply` writes the ids to a JSON file BEFORE it updates
 * anything, and `--revert <file> --apply` switches exactly those rows back on
 * (only the ones still off — anything the athlete changed since stays theirs).
 *
 * Expect Total Workouts and Avg / Week to fall and Avg Duration to rise once
 * this runs. That is the point, but it looks like a regression if you are not
 * expecting it.
 *
 * Usage:
 *   pnpm tsx script/backfill-counts-as-training.ts                         # dry run
 *   pnpm tsx script/backfill-counts-as-training.ts --apply                 # write + record
 *   pnpm tsx script/backfill-counts-as-training.ts --revert <file>         # dry-run the undo
 *   pnpm tsx script/backfill-counts-as-training.ts --revert <file> --apply # undo
 *
 * Flags:
 *   --apply          Actually write. Without it, nothing is modified.
 *   --user-id <id>   Restrict to one athlete.
 *   --quiet          Summary only; skip the per-sport lines.
 *   --revert <file>  Switch the ids a previous `--apply` recorded back on.
 */

import { readFile, writeFile } from "node:fs/promises";

import { countsAsTraining } from "@shared/deviceSportTypes";
import { inChunks, inSequence } from "@shared/inSequence";
import { workoutLogs } from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { db } from "../server/db";
import { type BackfillFlags, runBackfill, say } from "./backfillCli";

/**
 * When sync-time stamping shipped (commit 8219e83) — the earliest any import
 * could have been stamped. Imports between this and the deploy were not, and
 * the backfill leaves them counting: the side that never overrides an athlete.
 */
export const STAMPED_AT_SYNC_SINCE = "2026-09-12T18:22:37Z";

const RECORD_KIND = "counts-as-training-backfill";

/** The columns the backfill judges a row by. */
export interface DeviceImportRow {
  id: string;
  date: string;
  focus: string;
  source: string | null;
  planDayId: string | null;
  deviceLinkSource: string | null;
  deviceActivity: { raw?: { sport_type?: string; type?: string }; linkedAt?: string } | null;
}

/** The provider's own sport for a row, or null when there is nothing to read. */
function sportTypeOf(log: Pick<DeviceImportRow, "focus" | "deviceActivity">): string | null {
  const raw = log.deviceActivity?.raw;
  return raw?.sport_type || raw?.type || log.focus || null;
}

/** A row the sync created that nobody has since linked, moved onto a plan day or adopted. */
export function isUnadoptedImport(row: DeviceImportRow): boolean {
  return (
    (row.source === "strava" || row.source === "garmin") &&
    row.planDayId === null &&
    row.deviceLinkSource === null
  );
}

/** Whether the row was imported before the sync stamped the column (see the header). */
export function importedBeforeStamping(row: DeviceImportRow): boolean {
  const linkedAt = row.deviceActivity?.linkedAt;
  // An unreadable instant compares false, which leaves the row alone.
  if (linkedAt) return Date.parse(linkedAt) < Date.parse(STAMPED_AT_SYNC_SINCE);
  return row.date < STAMPED_AT_SYNC_SINCE.slice(0, 10);
}

/** The deny-list sport a row is demoted for, or null when the backfill must leave it alone. */
export function demotionSportFor(row: DeviceImportRow): string | null {
  if (!isUnadoptedImport(row) || !importedBeforeStamping(row)) return null;
  const sport = sportTypeOf(row);
  return sport && !countsAsTraining(sport) ? sport : null;
}

/** The record `--apply` writes, as JSON. */
export function formatBackfillRecord(
  ids: readonly string[],
  userId: string | undefined,
  now: Date,
): string {
  return JSON.stringify(
    { kind: RECORD_KIND, createdAt: now.toISOString(), userId: userId ?? null, ids },
    null,
    2,
  );
}

/** The ids a record holds; throws on anything that is not one of ours. */
export function parseBackfillRecord(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Not a backfill record");
  const { kind, ids } = parsed as { kind?: unknown; ids?: unknown };
  if (
    kind !== RECORD_KIND ||
    !Array.isArray(ids) ||
    !ids.every((id): id is string => typeof id === "string")
  ) {
    throw new Error(`Not a ${RECORD_KIND} record`);
  }
  return ids;
}

/** `--revert <file>`'s path, undefined without the flag; throws when it has no value. */
export function revertPathFrom(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--revert");
  if (at === -1) return undefined;
  const path = argv.at(at + 1);
  if (!path || path.startsWith("--"))
    throw new Error("--revert needs the record file a previous --apply wrote");
  return path;
}

/** Set the column on these rows, only where it still holds the other value. */
async function setCountsAsTraining(ids: readonly string[], value: boolean): Promise<void> {
  // Chunked: a single IN list of tens of thousands of ids is a query no
  // planner enjoys, and the backfill has no reason to be one statement.
  const CHUNK = 500;
  await inSequence(inChunks(ids, CHUNK), async (chunk) => {
    await db
      .update(workoutLogs)
      .set({ countsAsTraining: value })
      .where(and(inArray(workoutLogs.id, chunk), eq(workoutLogs.countsAsTraining, !value)));
  });
}

async function demote(flags: BackfillFlags): Promise<void> {
  // Device rows only, still at the default, and only what the sync created and
  // nobody adopted; demotionSportFor re-checks each row and adds the rest.
  const conditions = [
    eq(workoutLogs.countsAsTraining, true),
    or(isNotNull(workoutLogs.stravaActivityId), isNotNull(workoutLogs.garminActivityId)),
    inArray(workoutLogs.source, ["strava", "garmin"]),
    isNull(workoutLogs.planDayId),
    isNull(workoutLogs.deviceLinkSource),
  ];
  if (flags.userId) conditions.push(eq(workoutLogs.userId, flags.userId));

  const rows = await db
    .select({
      id: workoutLogs.id,
      date: workoutLogs.date,
      focus: workoutLogs.focus,
      source: workoutLogs.source,
      planDayId: workoutLogs.planDayId,
      deviceLinkSource: workoutLogs.deviceLinkSource,
      deviceActivity: workoutLogs.deviceActivity,
    })
    .from(workoutLogs)
    .where(and(...conditions));

  const demoteIds: string[] = [];
  const bySport = new Map<string, number>();
  for (const row of rows) {
    const sport = demotionSportFor(row);
    if (!sport) continue;
    demoteIds.push(row.id);
    bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
  }

  if (!flags.quiet) {
    for (const [sport, count] of [...bySport].sort((a, b) => b[1] - a[1])) {
      say(`  ${sport}: ${count}`);
    }
  }

  if (flags.apply && demoteIds.length > 0) {
    // Recorded before anything changes, so a run that dies half way is still
    // reversible, and a record that cannot be written stops the run.
    const now = new Date();
    const recordPath = `counts-as-training-backfill-${now.toISOString().replaceAll(":", "-")}.json`;
    await writeFile(recordPath, formatBackfillRecord(demoteIds, flags.userId, now), "utf8");
    say(
      `Recorded ${demoteIds.length} id(s) in ${recordPath}. Undo: --revert ${recordPath} --apply`,
    );
    await setCountsAsTraining(demoteIds, false);
  }

  say(
    `${flags.apply ? "Backfill complete" : "Dry run (re-run with --apply to write)"}: ` +
      `${demoteIds.length} of ${rows.length} unadopted device import(s) no longer count as training.`,
  );
}

async function revert(recordPath: string, flags: BackfillFlags): Promise<void> {
  const ids = parseBackfillRecord(await readFile(recordPath, "utf8"));
  if (flags.apply) await setCountsAsTraining(ids, true);
  say(
    `${flags.apply ? "Revert complete" : "Dry run (re-run with --apply to write)"}: ` +
      `of ${ids.length} recorded import(s), those still switched off ` +
      `${flags.apply ? "count" : "would count"} as training again.`,
  );
}

async function main(flags: BackfillFlags): Promise<void> {
  const recordPath = revertPathFrom(process.argv.slice(2));
  if (recordPath) {
    await revert(recordPath, flags);
    return;
  }
  await demote(flags);
}

if (process.argv[1]?.endsWith("backfill-counts-as-training.ts")) runBackfill(main);
