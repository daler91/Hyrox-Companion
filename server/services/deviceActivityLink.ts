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
 * The sync reconciler and the link/unlink routes are the only callers.
 */
import {
  type DeviceActivitySnapshot,
  type DeviceLinkSource,
  type PlanDay,
  type StravaActivitySummary,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import type { DistanceUnit } from "@shared/unitConversion";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { storage } from "../storage";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { createWorkoutInTx, type WorkoutTx } from "./workoutService";

/** The workout_logs columns a device recording can fill. */
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
 */
export function legacyRawFromLog(log: WorkoutLog): StravaActivitySummary {
  if (!log.stravaActivityId)
    throw new AppError(ErrorCode.CONFLICT, "Workout carries no Strava activity", 409);
  const name = (log.notes ?? "").split(" | ")[0].trim();
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
}

/**
 * The plan day has no log yet, so the activity becomes its log — built the
 * way a manual confirm builds one (prescription text, copied sets and
 * structure, adherence snapshot, day marked completed) with the recording's
 * metrics on top. RPE stays NULL: a watch cannot tell how it felt.
 */
export async function createLogFromPlanDayWithStravaInTx(
  tx: WorkoutTx,
  input: CreateFromPlanDayInput,
): Promise<WorkoutLog> {
  const { planDay, raw, metrics } = input;
  const activityLabel = raw.name?.trim() ? `Strava: ${raw.name.trim()}` : null;
  return await createWorkoutInTx(
    tx,
    {
      date: planDay.scheduledDate ?? raw.start_date_local.split("T")[0],
      focus: planDay.focus,
      mainWorkout: planDay.mainWorkout,
      accessory: planDay.accessory ?? null,
      notes: joinNotes(planDay.notes, activityLabel),
      rpe: null,
      planDayId: planDay.id,
      planId: planDay.planId,
      source: "strava",
      stravaActivityId: String(raw.id),
      ...metrics,
      deviceLinkSource: input.linkSource,
      deviceLinkConfidence: input.confidence,
      deviceActivity: stravaSnapshot(
        raw,
        DEVICE_METRIC_COLUMNS.filter((col) => metrics[col] != null),
      ),
    },
    undefined,
    undefined,
    input.userId,
  );
}

export type ManualLinkTarget = { planDayId: string } | { workoutLogId: string };

/**
 * The athlete says a standalone device log belongs to a plan day or to a log
 * they wrote themselves. Merges the recording into the target and removes
 * the standalone row, atomically. `manual` links are never revisited by the
 * sync.
 */
export async function linkStandaloneDeviceLog(input: {
  userId: string;
  deviceLogId: string;
  target: ManualLinkTarget;
}): Promise<WorkoutLog> {
  const { userId, deviceLogId, target } = input;
  return await db.transaction(async (tx) => {
    const [deviceLog] = await tx
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.id, deviceLogId), eq(workoutLogs.userId, userId)))
      .for("update");
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

    const raw = deviceLog.deviceActivity?.raw ?? legacyRawFromLog(deviceLog);
    const metrics = pickDeviceMetrics(deviceLog);

    // Free the (user, strava_activity_id) slot before the target takes it.
    await tx.delete(workoutLogs).where(eq(workoutLogs.id, deviceLog.id));

    if ("workoutLogId" in target) {
      if (target.workoutLogId === deviceLog.id) {
        throw new AppError(ErrorCode.BAD_REQUEST, "Cannot link a workout to itself", 400);
      }
      const attached = await attachStravaActivityToLogInTx(tx, {
        logId: target.workoutLogId,
        userId,
        raw,
        metrics,
        linkSource: "manual",
        confidence: null,
      });
      if (!attached) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "Target workout not found or already has a device activity",
          409,
        );
      }
      return attached;
    }

    const planDay = await storage.plans.getPlanDay(target.planDayId, userId, tx);
    if (!planDay) throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);

    const [dayLog] = await tx
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.planDayId, planDay.id), eq(workoutLogs.userId, userId)))
      .limit(1);
    if (dayLog) {
      const attached = await attachStravaActivityToLogInTx(tx, {
        logId: dayLog.id,
        userId,
        raw,
        metrics,
        linkSource: "manual",
        confidence: null,
      });
      if (!attached) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "That plan day's workout already has a device activity",
          409,
        );
      }
      return attached;
    }

    return await createLogFromPlanDayWithStravaInTx(tx, {
      userId,
      planDay,
      raw,
      metrics,
      linkSource: "manual",
      confidence: null,
    });
  });
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
 *  - a plan-day log the link CREATED (source "strava" + plan day): the row
 *    has no athlete-authored content, so it is deleted and the plan day's
 *    status is re-derived (back to planned, unless the day was skipped/missed
 *    by hand).
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
    const snapshot = log.deviceActivity;
    const raw = snapshot?.raw ?? legacyRawFromLog(log);

    const standaloneRow = mapStravaActivityToWorkout(raw, userId, distanceUnit);
    // The list row never carries calories; the linked row does if the link
    // fetched them. Carry them across so the split loses nothing.
    if (standaloneRow.calories == null && snapshot?.filledColumns.includes("calories")) {
      standaloneRow.calories = log.calories;
    }

    let remaining: WorkoutLog | null;
    if (log.source === "strava" && log.planDayId) {
      await tx.delete(workoutLogs).where(eq(workoutLogs.id, log.id));
      await syncPlanDayStatusFromWorkouts(log.planDayId, userId, tx);
      remaining = null;
    } else {
      const reset: Record<string, null> = {};
      for (const col of snapshot?.filledColumns ?? []) reset[col] = null;
      [remaining] = await tx
        .update(workoutLogs)
        .set({
          ...reset,
          stravaActivityId: null,
          deviceLinkSource: null,
          deviceLinkConfidence: null,
          deviceActivity: null,
        })
        .where(eq(workoutLogs.id, log.id))
        .returning();
    }

    const [standalone] = await tx
      .insert(workoutLogs)
      .values({ ...standaloneRow, deviceActivity: stravaSnapshot(raw, []) })
      .returning();

    return { log: remaining ?? null, standalone };
  });
}
