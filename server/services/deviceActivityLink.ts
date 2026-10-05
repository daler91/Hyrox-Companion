/**
 * Device activity link operations.
 *
 * Every way a Strava activity comes to sit on a workout_logs row goes through
 * here, so the invariants live in one place:
 *
 *  - Attaching never overwrites a value the athlete typed. A metric column is
 *    written only when it is NULL on the row; the columns that were filled
 *    are recorded in `device_activity.filledColumns`.
 *  - Unlinking reverses exactly that, and re-materialises the activity as the
 *    standalone device log the sync would have produced had it never matched.
 *    Nothing is lost in either direction, so a wrong match is a two-tap fix.
 *  - A row holds at most one device activity (partial unique index on
 *    (user_id, strava_activity_id); attach requires both device ids NULL).
 *  - `manual` links are the athlete's decision and outrank the matcher.
 *
 * Callers: the sync reconciler, the link/unlink routes, and planService, which
 * releases a plan day's device activity when the day is un-completed.
 */
import {
  type DeviceActivitySnapshot,
  type DeviceLinkSource,
  type ExerciseSet,
  exerciseSets,
  type PlanDay,
  type StravaActivitySummary,
  type WorkoutLog,
  workoutLogs,
  workoutStructureBlocks,
} from "@shared/schema";
import type { DistanceUnit } from "@shared/unitConversion";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { storage } from "../storage";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import { deviceActivitySetRow } from "./deviceActivitySets";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { loadUnitPreferences } from "./unitPreferences";
import { createWorkoutInTx, type WorkoutTx } from "./workoutService";
import { persistAdherenceSnapshot } from "./workoutService/adherence";

/**
 * The workout_logs columns a device recording can fill.
 *
 * `rpe` is the one that is not a measurement. It is here because a Strava
 * activity can carry the athlete's own Perceived Exertion (see
 * `perceivedExertionToRpe`), and a rating they gave on Strava should reach
 * the log that takes the recording, follow the same fill-only-NULL rule, and
 * leave again on unlink like every other column the link wrote. Nothing here
 * ever estimates one.
 */
export const DEVICE_METRIC_COLUMNS = [
  "duration",
  "calories",
  "distanceMeters",
  "elevationGain",
  "avgHeartrate",
  "maxHeartrate",
  "avgSpeed",
  "maxSpeed",
  "avgCadence",
  "avgWatts",
  "sufferScore",
  "startedAt",
  "rpe",
] as const;

export type DeviceMetricColumn = (typeof DEVICE_METRIC_COLUMNS)[number];
export type DeviceMetrics = Pick<WorkoutLog, DeviceMetricColumn>;

/** Metric columns off a mapper row (or any log-shaped object). */
export function pickDeviceMetrics(row: Partial<WorkoutLog>): DeviceMetrics {
  const out = {} as Record<DeviceMetricColumn, unknown>;
  for (const col of DEVICE_METRIC_COLUMNS) out[col] = row[col] ?? null;
  return out as DeviceMetrics;
}

export function stravaSnapshot(
  raw: StravaActivitySummary,
  filledColumns: readonly string[],
): DeviceActivitySnapshot {
  return {
    provider: "strava",
    raw,
    filledColumns: [...filledColumns],
    linkedAt: new Date().toISOString(),
  };
}

/**
 * Best-effort raw activity for a standalone device log imported before the
 * snapshot column existed. The mapper writes the activity name first into
 * `notes` and the sport type into `focus`, so those round-trip; anything the
 * list row had that the log never stored (kilojoules, PR counts) is gone.
 *
 * The name comes from the first line only: the mapper writes its notes on
 * one line, so anything after it was typed on the row. Read from the whole
 * text, a note typed under a name with no heart rate after it became part of
 * the name, and linking the import carried the import's own line onto the
 * target as if the athlete had typed it (notesTypedOnStandaloneLog).
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function legacyRawFromLog(log: WorkoutLog): StravaActivitySummary {
  if (!log.stravaActivityId)
    throw new AppError(ErrorCode.CONFLICT, "Workout carries no Strava activity", 409);
  const name = (log.notes ?? "").split("\n")[0].split(" | ")[0].trim();
  const startDate = log.startedAt ? new Date(log.startedAt).toISOString() : `${log.date}T00:00:00Z`;
  return {
    id: Number(log.stravaActivityId),
    name,
    type: log.focus,
    sport_type: log.focus,
    start_date: startDate,
    start_date_local: `${log.date}T00:00:00Z`,
    distance: log.distanceMeters ?? 0,
    moving_time: (log.duration ?? 0) * 60,
    elapsed_time: (log.duration ?? 0) * 60,
    total_elevation_gain: log.elevationGain ?? 0,
    average_speed: log.avgSpeed ?? 0,
    max_speed: log.maxSpeed ?? 0,
    average_heartrate: log.avgHeartrate ?? undefined,
    max_heartrate: log.maxHeartrate ?? undefined,
    average_cadence: log.avgCadence ?? undefined,
    average_watts: log.avgWatts ?? undefined,
    calories: log.calories ?? undefined,
    suffer_score: log.sufferScore ?? undefined,
  };
}

function joinNotes(...parts: Array<string | null | undefined>): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join("\n") : null;
}

/** The line a plan-day log created from a recording carries in its notes. */
export function stravaActivityLabel(raw: Pick<StravaActivitySummary, "name">): string | null {
  const name = raw.name?.trim();
  return name ? `Strava: ${name}` : null;
}

/**
 * Notes without the activity label, for a log whose recording is being
 * released: the label says "this session is the recording", which stops
 * being true the moment the recording gets its own row again. Only the
 * exact label line goes; anything the athlete typed stays.
 */
export function stripStravaActivityLabel(notes: string | null, log: WorkoutLog): string | null {
  const raw = log.deviceActivity?.raw;
  const label = raw ? stravaActivityLabel(raw) : null;
  if (!notes || !label) return notes;
  const kept = notes.split("\n").filter((line) => line.trim() !== label);
  return kept.length > 0 ? kept.join("\n") : null;
}

const CLEARED_SUGGESTION = {
  suggestedPlanDayId: null,
  suggestedWorkoutLogId: null,
  suggestedLinkConfidence: null,
} as const;

export interface AttachInput {
  logId: string;
  userId: string;
  raw: StravaActivitySummary;
  metrics: DeviceMetrics;
  linkSource: DeviceLinkSource;
  confidence: number | null;
}

/**
 * Attach a Strava activity to an existing log. Fills only NULL metric
 * columns. Returns undefined when the row is missing, not the user's, or
 * already carries a device activity (a concurrent sync got there first) — the
 * caller then falls back to a standalone import.
 */
export async function attachStravaActivityToLogInTx(
  tx: WorkoutTx,
  input: AttachInput,
): Promise<WorkoutLog | undefined> {
  const [existing] = await tx
    .select()
    .from(workoutLogs)
    .where(
      and(
        eq(workoutLogs.id, input.logId),
        eq(workoutLogs.userId, input.userId),
        isNull(workoutLogs.stravaActivityId),
        isNull(workoutLogs.garminActivityId),
      ),
    )
    .for("update");
  if (!existing) return undefined;

  const fill: Partial<DeviceMetrics> = {};
  const filledColumns: DeviceMetricColumn[] = [];
  for (const col of DEVICE_METRIC_COLUMNS) {
    const incoming = input.metrics[col];
    if (existing[col] == null && incoming != null) {
      (fill as Record<string, unknown>)[col] = incoming;
      filledColumns.push(col);
    }
  }

  const [updated] = await tx
    .update(workoutLogs)
    .set({
      ...fill,
      stravaActivityId: String(input.raw.id),
      deviceLinkSource: input.linkSource,
      deviceLinkConfidence: input.confidence,
      deviceActivity: stravaSnapshot(input.raw, filledColumns),
      ...CLEARED_SUGGESTION,
    })
    .where(eq(workoutLogs.id, existing.id))
    .returning();
  return updated;
}

export interface CreateFromPlanDayInput {
  userId: string;
  planDay: PlanDay;
  raw: StravaActivitySummary;
  metrics: DeviceMetrics;
  linkSource: DeviceLinkSource;
  confidence: number | null;
  /**
   * What the athlete typed on the standalone import a manual link merges
   * (notesTypedOnStandaloneLog): written after the activity label, as part of
   * the notes the log is created with. Never set by an auto link.
   */
  carriedNotes?: string | null;
}

/**
 * The plan day has no log yet, so the activity becomes its log: the day's
 * prescription text and the recording's metrics. RPE comes only from the
 * athlete's own Strava rating, when `metrics` carries one; otherwise it stays
 * NULL, because a watch cannot tell how it felt.
 *
 * What it records as PERFORMED depends on who made the link:
 *
 *  - `manual`: the athlete said "this recording was that session", so the log
 *    is built the way a manual confirm builds one (copied sets and structure,
 *    adherence snapshot, day marked completed).
 *  - `auto`: nobody has looked at it, so nothing of the prescription is copied
 *    in as an actual. D12 (CODEBASE_ANALYSIS_2026-10-03): the copy recorded a
 *    planned 8 km tempo run as 8 km when the watch measured 6.1, and let a
 *    "Weight Training" recording complete a strength day with a 110 kg squat
 *    nobody lifted — false running volume, false PRs, 100% compliance. The
 *    log carries only what the recording measured: the one set
 *    deviceActivitySetRow builds for a distance/cardio sport (none for
 *    "WeightTraining" or "Workout", whose content a watch cannot see), and no
 *    compliance, since one continuous recording cannot be compared set for
 *    set with a prescription. Editing the sets re-derives it like any log.
 *
 * The notes are the day's, the activity label, then `carriedNotes`, in that
 * order (notesCarriedByManualLink reads them back), and the log's notes
 * snapshot (prescribedNotes) holds all three. The carried note is part of
 * what the link brought rather than an edit of the log: added after the
 * snapshot, it made hasAthleteEdits keep an otherwise untouched log on
 * unlink, the copied prescription recorded as performed next to the released
 * run, and the day still completed. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function createLogFromPlanDayWithStravaInTx(
  tx: WorkoutTx,
  input: CreateFromPlanDayInput,
): Promise<WorkoutLog> {
  const { planDay, raw, metrics } = input;
  const payload = {
    date: planDay.scheduledDate ?? raw.start_date_local.split("T")[0],
    focus: planDay.focus,
    mainWorkout: planDay.mainWorkout,
    accessory: planDay.accessory ?? null,
    notes: joinNotes(planDay.notes, stravaActivityLabel(raw), input.carriedNotes),
    planDayId: planDay.id,
    planId: planDay.planId,
    source: "strava",
    stravaActivityId: String(raw.id),
    ...metrics,
    deviceLinkSource: input.linkSource,
    deviceLinkConfidence: input.confidence,
    deviceActivity: stravaSnapshot(
      raw,
      Object.entries(metrics).flatMap(([col, value]) => (value == null ? [] : [col])),
    ),
  };
  if (input.linkSource === "manual") {
    return await createWorkoutInTx(tx, payload, undefined, undefined, input.userId);
  }

  const [log] = await tx
    .insert(workoutLogs)
    .values({
      ...payload,
      userId: input.userId,
      // The text the log was created with, as createWorkoutInTx snapshots it:
      // hasAthleteEdits reads an edit as a difference from it.
      prescribedMainWorkout: payload.mainWorkout,
      prescribedAccessory: payload.accessory,
      prescribedNotes: payload.notes,
      // The durable record that this log holds none of the prescription. The
      // link columns say so only while the link stands; unlink adopts an
      // edited log as `manual` and clears them, and this stays, so "Reopen
      // workout" and the text-parsing paths still know the log for what it
      // is. Only here: a manual link copies the prescription in.
      // D12 (CODEBASE_ANALYSIS_2026-10-03)
      autoLinkRecordingOnly: true,
    })
    .returning();
  const recordedSet = deviceActivitySetRow(log, await loadUnitPreferences(input.userId));
  if (recordedSet) await tx.insert(exerciseSets).values(recordedSet);
  await syncPlanDayStatusFromWorkouts(planDay.id, input.userId, tx);
  return log;
}

export type ManualLinkTarget = { planDayId: string } | { workoutLogId: string };

/**
 * The athlete says a standalone device log belongs to a plan day or to a log
 * they wrote themselves. Merges the recording into the target and removes
 * the standalone row, atomically. `manual` links are never revisited by the
 * sync.
 *
 * Anything the athlete typed on the standalone row goes onto the target's
 * notes rather than with the deleted row (notesTypedOnStandaloneLog): above
 * all a note unlink carried over from the recording's set on the log it left,
 * so linking the recording again, the second tap of fixing a wrong match,
 * keeps it. On a plan day with no log it is part of the log the link creates
 * (createLogFromPlanDayWithStravaInTx), so unlinking that log again, while
 * nothing else on it changed, still deletes it and hands the note back to the
 * recording. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function linkStandaloneDeviceLog(input: {
  userId: string;
  deviceLogId: string;
  target: ManualLinkTarget;
}): Promise<WorkoutLog> {
  const { userId, deviceLogId, target } = input;
  return await db.transaction(async (tx) => {
    const deviceLog = await lockStandaloneDeviceLog(tx, deviceLogId, userId);
    const raw = deviceLog.deviceActivity?.raw ?? legacyRawFromLog(deviceLog);
    const metrics = pickDeviceMetrics(deviceLog);
    // Read before the delete below takes the row's sets with it.
    const carriedNotes = await notesTypedOnStandaloneLog(tx, deviceLog, raw);

    // Free the (user, strava_activity_id) slot before the target takes it.
    await tx.delete(workoutLogs).where(eq(workoutLogs.id, deviceLog.id));

    return await linkRecordingToTarget(tx, {
      userId,
      deviceLogId: deviceLog.id,
      target,
      raw,
      metrics,
      carriedNotes,
    });
  });
}

/** The standalone device log the athlete is linking, locked; refuses anything else. */
async function lockStandaloneDeviceLog(
  tx: WorkoutTx,
  deviceLogId: string,
  userId: string,
): Promise<WorkoutLog> {
  const locked = await tx
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.id, deviceLogId), eq(workoutLogs.userId, userId)))
    .for("update");
  const deviceLog = locked.at(0);
  if (!deviceLog) throw new AppError(ErrorCode.NOT_FOUND, "Workout not found", 404);
  if (
    !deviceLog.stravaActivityId ||
    (deviceLog.deviceActivity?.provider === undefined && deviceLog.source !== "strava")
  ) {
    throw new AppError(ErrorCode.CONFLICT, "Workout is not a Strava import", 409);
  }
  if (deviceLog.planDayId || deviceLog.deviceLinkSource) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "This Strava activity is already linked to a workout",
      409,
    );
  }
  return deviceLog;
}

/**
 * What the athlete typed on a standalone device log, which linking it
 * deletes: the notes on its set (the one unlink carries over from the
 * recording's set on the log it left, or one written here since), and every
 * line of the row's own notes the import did not write (the activity name and
 * heart rate, mapStravaActivityToWorkout), such as a note unlink put there for
 * a recording that describes no set. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function notesTypedOnStandaloneLog(
  tx: WorkoutTx,
  deviceLog: WorkoutLog,
  raw: StravaActivitySummary,
): Promise<string | null> {
  const sets = await tx
    .select({ notes: exerciseSets.notes })
    .from(exerciseSets)
    .where(eq(exerciseSets.workoutLogId, deviceLog.id))
    .orderBy(asc(exerciseSets.sortOrder));
  const imported = mapStravaActivityToWorkout(raw, deviceLog.userId).notes?.trim();
  const typedLines = (deviceLog.notes ?? "").split("\n").filter((line) => line.trim() !== imported);
  return joinNotes(...typedLines, ...sets.map((set) => set.notes));
}

/** `log` with `extra` added to the end of its notes, written; `log` itself when there is none. */
async function appendNotes(tx: WorkoutTx, log: WorkoutLog, extra: string | null): Promise<WorkoutLog> {
  if (!extra) return log;
  const [annotated] = await tx
    .update(workoutLogs)
    .set({ notes: joinNotes(log.notes, extra) })
    .where(eq(workoutLogs.id, log.id))
    .returning();
  return annotated;
}

/** A recording freed from its standalone row, and what the athlete typed on that row. */
interface RecordingToLink {
  userId: string;
  deviceLogId: string;
  target: ManualLinkTarget;
  raw: StravaActivitySummary;
  metrics: DeviceMetrics;
  carriedNotes: string | null;
}

/** Put a recording freed from its standalone row on the log or plan day the athlete chose. */
async function linkRecordingToTarget(tx: WorkoutTx, input: RecordingToLink): Promise<WorkoutLog> {
  const { userId, target } = input;
  if ("workoutLogId" in target) {
    if (target.workoutLogId === input.deviceLogId) {
      throw new AppError(ErrorCode.BAD_REQUEST, "Cannot link a workout to itself", 400);
    }
    return await attachManually(
      tx,
      input,
      target.workoutLogId,
      "Target workout not found or already has a device activity",
    );
  }

  const planDay = await storage.plans.getPlanDay(target.planDayId, userId, tx);
  if (!planDay) throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);

  const dayLogs = await tx
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.planDayId, planDay.id), eq(workoutLogs.userId, userId)))
    .limit(1);
  const dayLog = dayLogs.at(0);
  if (dayLog) {
    return await attachManually(
      tx,
      input,
      dayLog.id,
      "That plan day's workout already has a device activity",
    );
  }

  return await createLogFromPlanDayWithStravaInTx(tx, {
    userId,
    planDay,
    raw: input.raw,
    metrics: input.metrics,
    linkSource: "manual",
    confidence: null,
    carriedNotes: input.carriedNotes,
  });
}

/**
 * Attach the recording to a log that already exists, and add what the
 * athlete typed on the import to that log's notes. 409 with `conflict` when
 * the log is missing or already carries a recording.
 */
async function attachManually(
  tx: WorkoutTx,
  input: RecordingToLink,
  logId: string,
  conflict: string,
): Promise<WorkoutLog> {
  const attached = await attachStravaActivityToLogInTx(tx, {
    logId,
    userId: input.userId,
    raw: input.raw,
    metrics: input.metrics,
    linkSource: "manual",
    confidence: null,
  });
  if (!attached) throw new AppError(ErrorCode.CONFLICT, conflict, 409);
  return await appendNotes(tx, attached, input.carriedNotes);
}

/**
 * The exercise_sets columns a set PATCH can write that the set an auto link
 * synthesises from its recording leaves empty (deviceActivitySetRow): a label
 * (InlineSetEditor's label fan-out), the structure step it was assigned to
 * (StructureBlocksEditor), intensity, load, rep mode, tempo and standards.
 * The athlete put any value there. Unlike a note, which is about the run and
 * travels with the recording (releaseStravaActivityInTx), these describe the
 * set as part of their session, and the release writes a fresh set that has
 * none of them: a set holding one is theirs and stays on the log.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
type AthleteSetDetails = Pick<
  ExerciseSet,
  | "customLabel"
  | "blockId"
  | "stepNumber"
  | "intervalMinute"
  | "cycleNumber"
  | "stepRole"
  | "groupId"
  | "intensity"
  | "load"
  | "repMode"
  | "tempo"
  | "standards"
>;

/**
 * The columns that tell the set an auto link synthesised from its recording
 * apart. The athlete's own details and the note are optional for callers
 * that build a set by hand (tests): absent reads as empty. Every query here
 * selects whole rows.
 */
type RecordingSetFields = Pick<
  ExerciseSet,
  | "exerciseName"
  | "version"
  | "reps"
  | "weight"
  | "distance"
  | "time"
  | "distanceUnit"
  | "plannedReps"
  | "plannedWeight"
  | "plannedDistance"
  | "plannedTime"
> &
  Partial<AthleteSetDetails & Pick<ExerciseSet, "notes">>;

/** What a plan-day log the link created holds beyond its own columns. */
export interface LinkCreatedLogContents {
  /** The log's plan day; undefined when it has none (moved off it, or the day deleted) or it is gone. */
  planDay: Pick<PlanDay, "focus" | "scheduledDate" | "notes"> | undefined;
  sets: readonly RecordingSetFields[];
  /** Structure blocks on the log, scored or not (hasAthleteStructure). */
  blocks: number;
  /** Structure blocks carrying a score, which only the athlete enters. */
  scoredBlocks: number;
}

/**
 * Whether the athlete has put anything of their own on a plan-day log the
 * link created (isLinkCreatedLog: source "strava" + plan day, or an auto
 * link's log since moved off its day).
 *
 * Such a log starts as a pure derivative: the day's prescription text, the
 * recording's metrics, and the sets and structure the link wrote
 * (setsAsTheLinkWroteThem, hasAthleteStructure). A note a manual link brought
 * from the import it merged is in the notes the log was created with, so it
 * is no edit either (notesCarriedByManualLink). While it still is one,
 * deleting it loses nothing, because the prescription is still on the plan
 * day and the recording comes back as its own row. But it is the day's
 * working log and as editable as any other, so once the athlete has entered
 * actual sets, an RPE, notes, a block score or, on an auto link's log, a
 * structure on it, deleting it destroyed their session with no undo (D11,
 * CODEBASE_ANALYSIS_2026-10-03). A note on the set an auto link synthesised
 * from the recording is the exception: it is about the recording, and unlink
 * hands it to the recording's own row whichever way the log goes
 * (setsAsTheLinkWroteThem, D12).
 *
 * Errs towards "edited": a log kept by mistake costs the athlete one delete,
 * which the recycle bin can undo; a log deleted by mistake costs the session.
 */
export function hasAthleteEdits(log: WorkoutLog, contents: LinkCreatedLogContents): boolean {
  const filled = new Set<string>(log.deviceActivity?.filledColumns ?? []);
  const { planDay, sets } = contents;
  return (
    // createWorkoutInTx snapshots the text it created the log with into prescribed*.
    log.mainWorkout !== log.prescribedMainWorkout ||
    (log.accessory ?? null) !== (log.prescribedAccessory ?? null) ||
    (log.notes ?? null) !== (log.prescribedNotes ?? null) ||
    // Every metric the recording did not fill started NULL; a value there
    // (an RPE above all) was typed here.
    Object.entries(pickDeviceMetrics(log)).some(([col, value]) => !filled.has(col) && value != null) ||
    log.timeOfDayMin != null ||
    !log.countsAsTraining ||
    !keepsTheLinksTitleAndDate(log, planDay) ||
    !setsAsTheLinkWroteThem(log, sets) ||
    hasAthleteStructure(log, contents)
  );
}

/**
 * Whether the log's structure blocks hold anything of the athlete's.
 *
 * An auto link since D12 (CODEBASE_ANALYSIS_2026-10-03), marked
 * autoLinkRecordingOnly, writes no structure (createLogFromPlanDayWithStravaInTx),
 * so every block on its log, scored or not, is one the athlete built. A
 * structure saved on a log that holds the recording's set derives no set from
 * its steps and puts none on them (replaceStructureForOwner), so the sets
 * still read as the link's: counting only scored blocks, unlink deleted the
 * log as unedited and the structure with it, with nothing in the recycle bin.
 *
 * A manual link, and an auto link made before D12, copies the plan's
 * structure in (createWorkoutInTx), so there a block is the link's and only a
 * score, which only the athlete enters, is theirs.
 */
function hasAthleteStructure(
  log: WorkoutLog,
  { blocks, scoredBlocks }: Pick<LinkCreatedLogContents, "blocks" | "scoredBlocks">,
): boolean {
  return log.autoLinkRecordingOnly ? blocks > 0 : scoredBlocks > 0;
}

/**
 * Whether the log still has the title and date the link gave it: its plan
 * day's, while it is on one.
 *
 * A log an auto link created that the athlete moved off its day
 * (assignWorkoutPlanDay with no day), or whose day was deleted, no longer
 * says which day that was. Its date is checked against the recording's local
 * date instead, the only date an auto link matches a plan day on
 * (stravaReconciler). Its title, the day's focus, cannot be checked, so a
 * title the athlete changed is the one edit unlink does not see on such a
 * log; everything else hasAthleteEdits reads is still checked. Moving the
 * log off its day is not an edit of its own: the log still holds nothing of
 * the athlete's. Any other log without a day reads as edited. So does one
 * the athlete reassigned to another plan day, unless the two days share both
 * focus and date: the move changes neither on the log, so it keeps the first
 * day's, and unlink keeps it on the new day as a manual log, without the
 * recording's set, rather than deleting it. That errs towards edited, and
 * nothing is counted twice.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
function keepsTheLinksTitleAndDate(
  log: WorkoutLog,
  planDay: LinkCreatedLogContents["planDay"],
): boolean {
  if (log.planDayId == null) {
    const recordedOn = log.deviceActivity?.raw.start_date_local.split("T")[0];
    return log.autoLinkRecordingOnly && log.date === recordedOn;
  }
  return (
    planDay !== undefined &&
    log.focus === planDay.focus &&
    log.date === (planDay.scheduledDate ?? log.date)
  );
}

/**
 * Whether a link-created log's sets are still what the link wrote, in either
 * shape it has written them:
 *
 *  - the copied prescription (a manual link, and an auto link made before
 *    D12): each prescribed set once, at version 1, with actuals equal to the
 *    prescription, counted by the adherence snapshot;
 *  - an auto link since D12 (CODEBASE_ANALYSIS_2026-10-03), marked
 *    autoLinkRecordingOnly: nothing, or the one set synthesised from the
 *    recording, uncorrected (isUncorrectedRecordingSet). A note on that set
 *    is not the athlete's edit of the log: it is about the recording and
 *    leaves with it (unlinkDeviceActivity). Nor is the adherence snapshot,
 *    which is not read for this shape: a set PATCH re-derives one
 *    (refreshDerivedStateAfterLoggedSetChange), and so does moving the log
 *    back onto its day (assignWorkoutPlanDay), from sets that are still the
 *    link's. Read as edits, a log whose only change was a note on the run
 *    was kept as an empty manual log that still completed the day, at 100%.
 *    A copy of the prescription on such a log is the athlete's (seed from
 *    plan), and reads as an edit.
 */
function setsAsTheLinkWroteThem(log: WorkoutLog, sets: LinkCreatedLogContents["sets"]): boolean {
  if (log.autoLinkRecordingOnly) {
    return sets.length <= 1 && sets.every((set) => isUncorrectedRecordingSet(log, set));
  }
  return (
    sets.length === (log.plannedSetCount ?? 0) &&
    sets.every(
      (set) =>
        set.version === 1 &&
        set.reps === set.plannedReps &&
        set.weight === set.plannedWeight &&
        set.distance === set.plannedDistance &&
        set.time === set.plannedTime,
    )
  );
}

/**
 * Whether a value read back from a `real` column is the one the synthesis
 * computed. The column is single precision, so a moving time of 30:34
 * (30.5666... minutes) reads back as 30.566668: compare at that precision
 * and no looser. The distance is whole metres or feet (roundStoredDistance),
 * which single precision holds exactly.
 */
function sameStoredReal(stored: number | null, synthesised: number | null | undefined): boolean {
  if (stored == null || synthesised == null) return stored == null && synthesised == null;
  return Math.fround(stored) === Math.fround(synthesised);
}

/**
 * Whether `log` is a plan-day log an AUTO link created whose link still
 * stands (on its day, or moved off it since): the only kind that carries a
 * set synthesised from its recording.
 * The source matters as much as the link: unlink adopts the log as `manual`,
 * and the sync may later auto-attach another recording to it, which writes
 * no set, so a set the athlete typed there that happens to equal the new
 * recording's synthesis is still theirs. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
function carriesAutoLinkRecordingSet(log: WorkoutLog): boolean {
  return log.source === "strava" && log.deviceLinkSource === "auto";
}

/**
 * The set deviceActivitySetRow would write for `log`'s recording, rebuilt in
 * the distance unit `set` is stamped with: the athlete's when the link wrote
 * it (a miles athlete's distance is stored in feet), whatever they prefer now.
 */
function recordingSetFor(
  log: WorkoutLog,
  set: RecordingSetFields,
): ReturnType<typeof deviceActivitySetRow> {
  return deviceActivitySetRow(log, { distanceUnit: set.distanceUnit === "ft" ? "miles" : "km" });
}

/** No reps, weight or prescription: the shape of a set synthesised from a recording. */
function hasRecordingSetShape(set: RecordingSetFields): boolean {
  return (
    set.reps == null &&
    set.weight == null &&
    set.plannedReps == null &&
    set.plannedWeight == null &&
    set.plannedDistance == null &&
    set.plannedTime == null
  );
}

/** Whether the athlete has written none of their own details on the set (AthleteSetDetails). */
function hasNoAthleteDetails(set: RecordingSetFields): boolean {
  const details = {
    customLabel: set.customLabel,
    blockId: set.blockId,
    stepNumber: set.stepNumber,
    intervalMinute: set.intervalMinute,
    cycleNumber: set.cycleNumber,
    stepRole: set.stepRole,
    groupId: set.groupId,
    intensity: set.intensity,
    load: set.load,
    repMode: set.repMode,
    tempo: set.tempo,
    standards: set.standards,
  } satisfies Record<keyof AthleteSetDetails, unknown>;
  return Object.values(details).every((value) => value == null);
}

/** Whether the recording measured a value here and the stored set still holds it. */
function keepsMeasuredValue(stored: number | null, synthesised: number | null | undefined): boolean {
  return synthesised != null && sameStoredReal(stored, synthesised);
}

/**
 * Whether the stored set holds one number the recording measured and has the
 * other changed: a correction of the watch, not its own figures saved again.
 * A recording that measured no distance has its distance "changed" by one the
 * athlete adds.
 */
function correctsOneMeasuredValue(
  set: RecordingSetFields,
  recorded: NonNullable<ReturnType<typeof deviceActivitySetRow>>,
): boolean {
  const changes = (stored: number | null, synthesised: number | null | undefined) =>
    !sameStoredReal(stored, synthesised ?? null);
  return (
    (keepsMeasuredValue(set.distance, recorded.distance) && changes(set.time, recorded.time)) ||
    (keepsMeasuredValue(set.time, recorded.time) && changes(set.distance, recorded.distance))
  );
}

/** What a set is of the recording its log's auto link synthesised it from (recordingSetState). */
type RecordingSetState = "as-recorded" | "corrected";

/**
 * What `set` is of the recording an auto link synthesised it from, on a log
 * that link created and still carries: the one reading of the recording's
 * set that unlink and "Reopen workout" share (D12,
 * CODEBASE_ANALYSIS_2026-10-03).
 *
 *  - "as-recorded": the recording's exercise with no reps, weight or
 *    prescription, and both numbers the recording measured, distance and
 *    moving time, exactly as deviceActivitySetRow builds them from the stored
 *    recording. The athlete did not correct the run, however often the set
 *    was saved since: any set PATCH bumps the version (a per-set note, the
 *    same value retyped in the debounced cell). Nor did they make it part of
 *    their session: no label, structure step, intensity, load, tempo or
 *    standards on it (AthleteSetDetails). A note is all it may carry.
 *  - "corrected": that set edited (version past 1), still holding one of the
 *    two numbers and with the other changed. Correcting the watch's 6.1 km to
 *    the 8 km they ran keeps the time. A recording that measured no distance
 *    has its distance "changed" by one the athlete adds.
 *  - null: a set of the athlete's own. Another exercise; reps, weight or a
 *    prescription; the watch's numbers with a label, step or other detail
 *    of theirs on it; a run rewritten in both numbers; a run typed in place
 *    of a deleted recording set (version 1, never edited, so not the link's
 *    set corrected, whichever number it shares).
 */
function recordingSetState(log: WorkoutLog, set: RecordingSetFields): RecordingSetState | null {
  if (!carriesAutoLinkRecordingSet(log) || !hasRecordingSetShape(set)) return null;
  const recorded = recordingSetFor(log, set);
  if (recorded === null || set.exerciseName !== recorded.exerciseName) return null;
  if (sameStoredReal(set.distance, recorded.distance) && sameStoredReal(set.time, recorded.time)) {
    return hasNoAthleteDetails(set) ? "as-recorded" : null;
  }
  return set.version !== 1 && correctsOneMeasuredValue(set, recorded) ? "corrected" : null;
}

/**
 * Whether `set`, on a plan-day log an AUTO link created and still carries, is
 * the set the link synthesised from the recording and the athlete has not
 * corrected: "as-recorded" (recordingSetState), whatever its version. Both of
 * its numbers are still the watch's and nothing of the athlete's session is
 * on it but perhaps a note, so it describes the recording, and it is not the
 * athlete's version of the run: isCorrectedRecordingSet reads it the same way.
 *
 * When the recording leaves the log, the set leaves with it, and the released
 * recording's own set takes its note: unlink takes it off the log it keeps
 * (takeRecordingSet), and "Reopen workout" leaves it out of the sets it folds
 * onto the day (planService athleteLoggedSets). releaseStravaActivityInTx
 * writes the same run on the recording's own row, so a copy left behind
 * counted the session twice: the kept log, or the reopened day completed
 * again, and the recording's row each held the watch's 6.1 km. Nor does it
 * make the log the athlete's (hasAthleteEdits). Reopen once took off only a
 * set nobody had saved since the link wrote it (version 1, no note), so it
 * folded a run the athlete had only annotated onto the day as an added run
 * while unlink released it. A run typed in place of a deleted recording set
 * with the watch's own numbers reads the same way: nothing but a note tells
 * it apart, and the note goes with the run. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function isUncorrectedRecordingSet(log: WorkoutLog, set: RecordingSetFields): boolean {
  return recordingSetState(log, set) === "as-recorded";
}

/**
 * Whether `set`, on a plan-day log an AUTO link created and still carries, is
 * the set the link synthesised from the recording, since corrected by the
 * athlete: "corrected" (recordingSetState). A run typed in place of a deleted
 * recording set (version 1), or rewritten in both numbers, keeps neither of
 * the watch's numbers as a correction would, and reads as one the athlete
 * added.
 *
 * A set still holding both of the watch's numbers is not a correction either,
 * however often it was saved (isUncorrectedRecordingSet): reading a set
 * given only a note as the athlete's version of the session put the watch's
 * 6.1 km in place of the prescribed 8 km on reopen. "Reopen workout" lets
 * only this set stand for the prescribed running (planService standsFor), so
 * a mistake here costs a duplicated run on the reopened day rather than the
 * prescribed one. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function isCorrectedRecordingSet(log: WorkoutLog, set: RecordingSetFields): boolean {
  return recordingSetState(log, set) === "corrected";
}

/** The recording's set takeRecordingSet took off a kept log. */
interface TakenRecordingSet {
  /** The note the athlete wrote on it, for the set the release writes on the recording's row. */
  notes: string | null;
  /** The sets the log keeps, for its adherence snapshot (rederiveAdherence). */
  remaining: ExerciseSet[];
}

/**
 * Take the recording's own set off a log an auto link created, as the
 * recording leaves it for its own row. The set is the first in sort order
 * (the link wrote it at 0) that the athlete has not corrected
 * (isUncorrectedRecordingSet): untouched, or saved again with only a note,
 * which the release puts on the recording's set. A set they corrected,
 * typed, added, or made part of their session (a label, a structure step:
 * AthleteSetDetails) is theirs and stays. Null when nothing was taken.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function takeRecordingSet(tx: WorkoutTx, log: WorkoutLog): Promise<TakenRecordingSet | null> {
  if (!carriesAutoLinkRecordingSet(log)) return null;
  const sets = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.workoutLogId, log.id))
    .orderBy(asc(exerciseSets.sortOrder));
  const recordingSet = sets.find((set) => isUncorrectedRecordingSet(log, set));
  if (!recordingSet) return null;
  await tx.delete(exerciseSets).where(eq(exerciseSets.id, recordingSet.id));
  return { notes: recordingSet.notes, remaining: sets.filter((set) => set !== recordingSet) };
}

/**
 * Re-derive the adherence snapshot of a kept plan-day log the recording's
 * set was taken off, if it has one: the snapshot a set edit (or moving the
 * log onto its day) wrote counted that set, and left alone it went on
 * counting a run the log no longer holds (actualSetCount, compliancePct). A
 * log with no snapshot keeps none: nothing counted the set, and an auto
 * link writes none. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function rederiveAdherence(
  tx: WorkoutTx,
  log: WorkoutLog,
  remaining: ExerciseSet[],
): Promise<void> {
  if (log.planDayId == null || log.plannedSetCount == null) return;
  await persistAdherenceSnapshot(tx, log.id, log.planDayId, remaining);
}

async function loadLinkCreatedLogContents(
  tx: WorkoutTx,
  log: WorkoutLog,
  userId: string,
): Promise<LinkCreatedLogContents> {
  const planDay = log.planDayId
    ? await storage.plans.getPlanDay(log.planDayId, userId, tx)
    : undefined;
  const sets = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.workoutLogId, log.id));
  // Every block, not only the scored ones: on an auto link's log any block
  // is the athlete's (hasAthleteStructure). D12 (CODEBASE_ANALYSIS_2026-10-03)
  const blocks = await tx
    .select({ score: workoutStructureBlocks.score })
    .from(workoutStructureBlocks)
    .where(eq(workoutStructureBlocks.workoutLogId, log.id));
  return {
    planDay,
    sets,
    blocks: blocks.length,
    scoredBlocks: blocks.filter((block) => block.score != null).length,
  };
}

/**
 * Whether a linked log is one the link CREATED rather than one of the
 * athlete's it enriched: source "strava" (their own logs are "manual", and so
 * is a link-created log unlink has adopted) and either on a plan day, or
 * marked autoLinkRecordingOnly by the auto link that created it.
 *
 * The marker is what still says so once the athlete moves the log off its
 * day (assignWorkoutPlanDay with no day) or the day is deleted. Read by the
 * plan day alone, such a log unwound like their own: it stayed a "strava"
 * log with no recording, kept the recording's set, and the released row got
 * a second copy of the run. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
function isLinkCreatedLog(log: WorkoutLog): boolean {
  return log.source === "strava" && (log.planDayId != null || log.autoLinkRecordingOnly);
}

/**
 * What is left of a linked log once unlink has taken the recording off it,
 * and what the athlete wrote about the recording there (the note on its set,
 * or one a manual link brought onto a log unlink deletes), for the set the
 * release writes on the recording's own row.
 */
interface UnwoundLog {
  /** The log unlink keeps; null when it deleted it. */
  log: WorkoutLog | null;
  recordingSetNotes: string | null;
}

/**
 * The note a manual link to a plan day with no log brought from the
 * standalone import it merged (linkStandaloneDeviceLog), as the log it
 * created still holds it: the lines after the "Strava: <name>" label, since
 * createLogFromPlanDayWithStravaInTx writes the day's notes, the label, then
 * the carried note. For a recording with no name, and so no label, the
 * lines that are not the day's notes. Null for an auto link, which carries
 * none: its log holds the day's notes and the label alone.
 *
 * Read only from a log unlink deletes as unedited (hasAthleteEdits), whose
 * notes are still the ones it was created with. A kept log keeps the note.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
function notesCarriedByManualLink(
  log: WorkoutLog,
  planDay: LinkCreatedLogContents["planDay"],
): string | null {
  if (log.deviceLinkSource !== "manual" || !log.notes) return null;
  const lines = log.notes.split("\n");
  const raw = log.deviceActivity?.raw;
  const label = raw ? stravaActivityLabel(raw) : null;
  const labelAt = label ? lines.findIndex((line) => line.trim() === label) : -1;
  if (labelAt >= 0) return joinNotes(...lines.slice(labelAt + 1));
  const dayLines = new Set((planDay?.notes ?? "").split("\n").map((line) => line.trim()));
  return joinNotes(...lines.filter((line) => !dayLines.has(line.trim())));
}

/**
 * Delete a log the link created that holds nothing of the athlete's
 * (hasAthleteEdits), and re-derive its plan day's status if it is on one.
 * What the athlete wrote that it holds goes to the recording's row: a note on
 * the recording's set, the one thing of theirs an auto link's log may hold
 * (setsAsTheLinkWroteThem), and the note a manual link brought from the
 * import it merged (notesCarriedByManualLink). Linking the recording to the
 * wrong day and back again therefore leaves the note where it started.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function deleteLinkCreatedLog(
  tx: WorkoutTx,
  log: WorkoutLog,
  userId: string,
  contents: LinkCreatedLogContents,
): Promise<UnwoundLog> {
  const recordingSet = contents.sets.find((set) => isUncorrectedRecordingSet(log, set));
  await tx.delete(workoutLogs).where(eq(workoutLogs.id, log.id));
  // Moved off its day, the log completed none.
  if (log.planDayId) await syncPlanDayStatusFromWorkouts(log.planDayId, userId, tx);
  return {
    log: null,
    recordingSetNotes: joinNotes(recordingSet?.notes, notesCarriedByManualLink(log, contents.planDay)),
  };
}

/**
 * Take the recording off a log unlink keeps: the athlete's own log, or one the
 * link created (`linkCreated`) that the athlete has since edited.
 */
async function keepLinkedLog(
  tx: WorkoutTx,
  log: WorkoutLog,
  userId: string,
  linkCreated: boolean,
): Promise<UnwoundLog> {
  // Not the set an auto link synthesised from the recording either, unless
  // the athlete corrected it or made it part of their session: the release
  // writes that set on the standalone row, and left here too it counted the
  // session twice. Taken first, so the adherence snapshot re-derived without
  // it lands before the update below returns the row.
  // D12 (CODEBASE_ANALYSIS_2026-10-03)
  const taken = linkCreated ? await takeRecordingSet(tx, log) : null;
  if (taken) await rederiveAdherence(tx, log, taken.remaining);
  const reset = Object.fromEntries(
    (log.deviceActivity?.filledColumns ?? []).map((col) => [col, null] as const),
  );
  // An edited log the link created is the athlete's from here on: a manual
  // log (on the day, if it is still on one), so the timeline stops presenting
  // it as a Strava import and offers it as a target for the right recording.
  // It keeps autoLinkRecordingOnly, left out of this patch on purpose: once
  // the link columns are cleared it is the only thing on the row that says
  // the log never held the prescription, which "Reopen workout" and the
  // text-parsing candidate queries read. D12 (CODEBASE_ANALYSIS_2026-10-03)
  const adopt = linkCreated
    ? {
        source: "manual",
        notes: stripStravaActivityLabel(log.notes, log),
        prescribedNotes: stripStravaActivityLabel(log.prescribedNotes, log),
      }
    : {};
  const [kept] = await tx
    .update(workoutLogs)
    .set({
      ...reset,
      ...adopt,
      stravaActivityId: null,
      deviceLinkSource: null,
      deviceLinkConfidence: null,
      deviceActivity: null,
    })
    .where(eq(workoutLogs.id, log.id))
    .returning();
  // The recording is no longer this log's, so neither is its stream. (A log
  // unlink deletes takes the stream row with it, by cascade.)
  await storage.sessionStreams.deleteForLog(log.id, userId, tx);
  return { log: kept, recordingSetNotes: taken?.notes ?? null };
}

export interface UnlinkResult {
  /** The row the activity was removed from; null when the row itself only existed because of the link. */
  log: WorkoutLog | null;
  /** The activity, back as a standalone device log. */
  standalone: WorkoutLog;
}

/**
 * Take a Strava activity off a log and give it back its own row.
 *
 * Two shapes of linked row exist and they unwind differently:
 *  - the athlete's own log (source "manual") that a link enriched: the
 *    filled metric columns go back to NULL and everything they typed stays;
 *  - a log the link CREATED (isLinkCreatedLog: source "strava" on a plan
 *    day, or moved off it since and marked autoLinkRecordingOnly): while it
 *    is still what the link built (see hasAthleteEdits) it holds nothing of
 *    the athlete's, so it is deleted and the plan day's status, if it is
 *    still on one, is re-derived (back to planned, unless the day was
 *    skipped/missed by hand). Once the athlete has edited it, it is their
 *    session: it unwinds like their own log and stays (on the day, if it is
 *    on one) as a manual log, minus the "Strava: <name>" line and, for an
 *    auto link, the set synthesised from the recording unless they corrected
 *    it (isUncorrectedRecordingSet), with its adherence snapshot re-derived
 *    without that set. An auto link's log keeps its autoLinkRecordingOnly
 *    marker.
 *
 * Either way a note the athlete wrote on the recording's set goes with the
 * set, onto the released row's (linkStandaloneDeviceLog carries it on again
 * if they link the recording elsewhere), and so does the note a manual link
 * carried onto a log unlink deletes (notesCarriedByManualLink).
 */
export async function unlinkDeviceActivity(input: {
  userId: string;
  logId: string;
  distanceUnit: DistanceUnit;
}): Promise<UnlinkResult> {
  const { userId, logId, distanceUnit } = input;
  return await db.transaction(async (tx) => {
    const [log] = await tx
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)))
      .for("update");
    if (!log) throw new AppError(ErrorCode.NOT_FOUND, "Workout not found", 404);
    if (!log.stravaActivityId || !log.deviceLinkSource) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "Workout has no linked Strava activity to remove",
        409,
      );
    }
    const linkCreated = isLinkCreatedLog(log);
    const contents = linkCreated ? await loadLinkCreatedLogContents(tx, log, userId) : undefined;
    const unwound =
      contents && !hasAthleteEdits(log, contents)
        ? await deleteLinkCreatedLog(tx, log, userId, contents)
        : await keepLinkedLog(tx, log, userId, linkCreated);

    const standalone = await releaseStravaActivityInTx(
      tx,
      log,
      userId,
      distanceUnit,
      unwound.recordingSetNotes,
    );

    return { log: unwound.log, standalone };
  });
}

/**
 * Re-materialise a linked recording as the standalone device log the sync
 * would have produced had it never matched. The caller must already have
 * taken the activity off (or deleted) the linked row: the partial unique
 * index on (user_id, strava_activity_id) refuses a second row otherwise.
 *
 * Shared by unlink and by "Reopen workout" (planService), which folds a
 * completed day's log back onto the day and deletes the log — the recording
 * is a measurement the athlete cannot type back in, so it survives the
 * reopen as its own row, and because that row keeps the activity id the next
 * sync neither re-imports it nor re-completes the day just reopened.
 *
 * `recordingSetNotes` is a note the athlete wrote on the recording's set on
 * the log it is leaving (unlink takes that set off with the log, or alone:
 * takeRecordingSet), or one a manual link carried onto a log unlink deletes
 * (notesCarriedByManualLink). It goes on the set written here, the
 * recording's own, so nothing they typed is lost with the copy.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function releaseStravaActivityInTx(
  tx: WorkoutTx,
  log: WorkoutLog,
  userId: string,
  distanceUnit: DistanceUnit,
  recordingSetNotes: string | null = null,
): Promise<WorkoutLog> {
  const snapshot = log.deviceActivity;
  const raw = snapshot?.raw ?? legacyRawFromLog(log);

  const standaloneRow = mapStravaActivityToWorkout(raw, userId, distanceUnit);
  // The list row never carries calories or the athlete's Strava rating; the
  // linked row does if the link filled them. Carry them across so the split
  // loses nothing.
  if (standaloneRow.calories == null && snapshot?.filledColumns.includes("calories")) {
    standaloneRow.calories = log.calories;
  }
  if (standaloneRow.rpe == null && snapshot?.filledColumns.includes("rpe")) {
    standaloneRow.rpe = log.rpe;
  }

  const [standalone] = await tx
    .insert(workoutLogs)
    .values({ ...standaloneRow, deviceActivity: stravaSnapshot(raw, []) })
    .returning();

  // Give it the same synthesised set a fresh standalone import gets, so an
  // unlink lands the activity in the set-derived analytics panels rather than
  // leaving a row only the overview cards can see. Written in the same
  // transaction as the log: a released recording with no set would be
  // indistinguishable from a pre-change import and never get one later.
  const setRow = deviceActivitySetRow(standalone, { distanceUnit });
  if (setRow) {
    await tx.insert(exerciseSets).values({ ...setRow, notes: recordingSetNotes });
    return standalone;
  }
  // No set to hold the athlete's note (the recording describes none here,
  // though it did on the log): the row's own notes take it instead.
  return await appendNotes(tx, standalone, recordingSetNotes);
}

/**
 * The athlete says the suggested match is wrong ("Not this one"). Clears the
 * suggestion so the timeline stops offering it; the standalone import itself
 * is untouched, and the row keeps its activity so a re-sync cannot revive
 * the suggestion. Idempotent; 404 when the row is not the athlete's.
 */
export async function dismissDeviceLinkSuggestion(input: {
  userId: string;
  logId: string;
}): Promise<WorkoutLog> {
  const [updated] = await db
    .update(workoutLogs)
    .set(CLEARED_SUGGESTION)
    .where(and(eq(workoutLogs.id, input.logId), eq(workoutLogs.userId, input.userId)))
    .returning();
  if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "Workout not found", 404);
  return updated;
}
