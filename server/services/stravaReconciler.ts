/**
 * Strava sync reconciler.
 *
 * Before this existed the sync inserted one standalone workout log per
 * activity, so an athlete who confirmed Tuesday's tempo run on the timeline
 * and then synced their watch ended up with two Tuesday cards. Now each new
 * activity is matched against the day's existing rows first:
 *
 *   link → workout_log   the athlete already logged it: attach the recording
 *                        (fill NULL metrics, never overwrite their numbers)
 *   link → plan_day      not logged yet: the activity becomes the day's log,
 *                        built like a manual confirm (prescription, copied
 *                        sets, adherence, day marked completed), RPE left NULL
 *   suggest              plausible but not certain: import standalone and
 *                        record the candidate for the timeline to offer
 *   none                 import standalone, exactly as before
 *
 * Dedup by (user, strava_activity_id) happens before this runs, so a manual
 * unlink (which re-creates the activity as a standalone row) is sticky, as is
 * a manual link. Matching only ever considers rows with no device activity.
 */
import {
  type PlanDay,
  planDays,
  type StravaActivitySummary,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import type { logger } from "../logger";
import { storage } from "../storage";
import {
  attachStravaActivityToLogInTx,
  createLogFromPlanDayWithStravaInTx,
  pickDeviceMetrics,
  stravaSnapshot,
} from "./deviceActivityLink";
import {
  DEFAULT_MATCH_THRESHOLDS,
  type DeviceActivityInput,
  type MatchCandidate,
  type MatchDecision,
  type MatchThresholds,
  planDeviceActivityMatches,
} from "./deviceActivityMatcher";
import type { mapStravaActivityToWorkout } from "./stravaMapper";

export type MappedStravaRow = ReturnType<typeof mapStravaActivityToWorkout>;

export interface StravaImportItem {
  activity: StravaActivitySummary;
  /** The mapper's standalone row for this activity (calorie-enriched already). */
  row: MappedStravaRow;
}

export interface ReconcileCounts {
  /** Existing logs that gained the recording. */
  enriched: number;
  /** Open plan days completed by a recording. */
  completedPlanDays: number;
  /** Standalone imports carrying a suggested target. */
  suggested: number;
  /** Standalone imports with no plausible target. */
  standalone: number;
  /** Activities another sync imported while this one ran. */
  skipped: number;
}

type SyncLogger = Pick<typeof logger, "info" | "warn">;

/** "2026-09-08T06:30:12Z" (Strava's local wall clock, Z-suffixed) → 390. */
export function localStartMinutesFromStrava(
  startDateLocal: string | null | undefined,
): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(startDateLocal ?? "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function deviceActivityInputFromStrava(
  activity: StravaActivitySummary,
): DeviceActivityInput {
  return {
    externalId: String(activity.id),
    name: activity.name ?? "",
    sportType: activity.sport_type || activity.type || "",
    localDate: activity.start_date_local.split("T")[0],
    localStartMinutes: localStartMinutesFromStrava(activity.start_date_local),
    movingTimeSec: activity.moving_time ?? 0,
    distanceMeters: activity.distance ?? 0,
  };
}

export function candidateFromLog(log: WorkoutLog): MatchCandidate {
  return {
    kind: "workout_log",
    id: log.id,
    focus: log.focus,
    mainWorkout: log.mainWorkout,
    accessory: log.accessory,
    durationMin: log.duration,
    distanceMeters: log.distanceMeters,
    localStartMinutes: log.timeOfDayMin,
  };
}

export function candidateFromPlanDay(day: PlanDay): MatchCandidate {
  return {
    kind: "plan_day",
    id: day.id,
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: day.accessory,
    durationMin: day.expectedDurationMin,
    distanceMeters: null,
    localStartMinutes: day.plannedTimeOfDayMin,
  };
}

/** Candidate rows for every date in the batch: two queries, not two per activity. */
export async function loadMatchCandidates(
  userId: string,
  dates: readonly string[],
): Promise<{
  byDate: Map<string, MatchCandidate[]>;
  logs: Map<string, WorkoutLog>;
  planDays: Map<string, PlanDay>;
}> {
  const [logs, days] = await Promise.all([
    storage.workouts.listDeviceUnlinkedLogsForDates(userId, dates),
    storage.plans.listOpenPlanDaysForDates(userId, dates),
  ]);
  const byDate = new Map<string, MatchCandidate[]>();
  const push = (date: string, c: MatchCandidate) => {
    const list = byDate.get(date) ?? [];
    list.push(c);
    byDate.set(date, list);
  };
  for (const log of logs) push(log.date, candidateFromLog(log));
  for (const day of days) if (day.scheduledDate) push(day.scheduledDate, candidateFromPlanDay(day));
  return {
    byDate,
    logs: new Map(logs.map((l) => [l.id, l])),
    planDays: new Map(days.map((d) => [d.id, d])),
  };
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const rec = current as { code?: unknown; cause?: unknown };
    if (rec.code === "23505") return true;
    current = rec.cause;
  }
  return false;
}

/**
 * Attach to the matched log. Undefined means the row was taken (or gone) between
 * planning and applying — the caller imports the activity standalone instead.
 */
async function applyLogLink(
  userId: string,
  item: StravaImportItem,
  logId: string,
  score: number,
): Promise<WorkoutLog | undefined> {
  return await db.transaction((tx) =>
    attachStravaActivityToLogInTx(tx, {
      logId,
      userId,
      raw: item.activity,
      metrics: pickDeviceMetrics(item.row),
      linkSource: "auto",
      confidence: score,
    }),
  );
}

/**
 * Complete the matched plan day with this recording. Re-checks for a log
 * under the plan day's row lock: if the athlete confirmed the day between
 * planning and applying, attach to that log rather than creating a second one.
 */
async function applyPlanDayLink(
  userId: string,
  item: StravaImportItem,
  planDay: PlanDay,
  score: number,
): Promise<{ log: WorkoutLog; enrichedExisting: boolean } | undefined> {
  return await db.transaction(async (tx) => {
    // A manual confirm of the same day marks it completed under this same
    // lock (createWorkoutInTx → plan_days UPDATE), so either it waits for us
    // or its log is already committed and visible to the lookup below.
    await tx
      .select({ id: planDays.id })
      .from(planDays)
      .where(eq(planDays.id, planDay.id))
      .for("update");
    const [existing] = await tx
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.planDayId, planDay.id), eq(workoutLogs.userId, userId)))
      .limit(1);
    const metrics = pickDeviceMetrics(item.row);
    if (existing) {
      const attached = await attachStravaActivityToLogInTx(tx, {
        logId: existing.id,
        userId,
        raw: item.activity,
        metrics,
        linkSource: "auto",
        confidence: score,
      });
      return attached ? { log: attached, enrichedExisting: true } : undefined;
    }
    const created = await createLogFromPlanDayWithStravaInTx(tx, {
      userId,
      planDay,
      raw: item.activity,
      metrics,
      linkSource: "auto",
      confidence: score,
    });
    return { log: created, enrichedExisting: false };
  });
}

/**
 * The standalone import row: the mapper's row plus an empty snapshot (so a
 * later manual link has the raw activity without an API call) and, when the
 * match was plausible but not certain, the candidate for the timeline to
 * offer. The suggestion columns are always spelled out so the insert shape
 * is one type and NULL means "nothing to offer".
 */
function standaloneRow(
  item: StravaImportItem,
  suggestion?: Extract<MatchDecision, { outcome: "suggest" }>,
) {
  const candidate = suggestion?.candidate;
  return {
    ...item.row,
    deviceActivity: stravaSnapshot(item.activity, []),
    suggestedPlanDayId: candidate?.kind === "plan_day" ? candidate.id : null,
    suggestedWorkoutLogId: candidate?.kind === "workout_log" ? candidate.id : null,
    suggestedLinkConfidence: suggestion?.score ?? null,
  };
}

export async function reconcileStravaActivities(
  userId: string,
  items: readonly StravaImportItem[],
  log: SyncLogger,
  thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS,
): Promise<ReconcileCounts> {
  const counts: ReconcileCounts = {
    enriched: 0,
    completedPlanDays: 0,
    suggested: 0,
    standalone: 0,
    skipped: 0,
  };
  if (items.length === 0) return counts;

  const dates = Array.from(new Set(items.map((i) => i.row.date)));
  const candidates = await loadMatchCandidates(userId, dates);
  const planned = planDeviceActivityMatches(
    items.map((i) => deviceActivityInputFromStrava(i.activity)),
    candidates.byDate,
    thresholds,
  );

  const standalone: ReturnType<typeof standaloneRow>[] = [];

  for (const [index, { decision }] of planned.entries()) {
    const item = items[index];
    try {
      if (decision.outcome === "link" && decision.candidate.kind === "workout_log") {
        const attached = await applyLogLink(userId, item, decision.candidate.id, decision.score);
        if (attached) {
          counts.enriched++;
          continue;
        }
        // Row was claimed meanwhile; fall through to a plain import.
        standalone.push(standaloneRow(item));
        continue;
      }
      if (decision.outcome === "link" && decision.candidate.kind === "plan_day") {
        const planDay = candidates.planDays.get(decision.candidate.id);
        const result = planDay
          ? await applyPlanDayLink(userId, item, planDay, decision.score)
          : undefined;
        if (result) {
          if (result.enrichedExisting) counts.enriched++;
          else counts.completedPlanDays++;
          continue;
        }
        standalone.push(standaloneRow(item));
        continue;
      }
      if (decision.outcome === "suggest") {
        standalone.push(standaloneRow(item, decision));
        continue;
      }
      standalone.push(standaloneRow(item));
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent sync imported this activity first. Counts only.
        counts.skipped++;
        continue;
      }
      throw err;
    }
  }

  if (standalone.length > 0) {
    // onConflictDoNothing on (user_id, strava_activity_id): only rows this
    // call actually created come back, so a race with another sync shows up
    // as `skipped` rather than an optimistic count.
    const created = await storage.workouts.createWorkoutLogs(standalone);
    const createdIds = new Set(created.map((c) => c.stravaActivityId));
    for (const row of standalone) {
      if (!createdIds.has(row.stravaActivityId)) {
        counts.skipped++;
      } else if (row.suggestedLinkConfidence != null) {
        counts.suggested++;
      } else {
        counts.standalone++;
      }
    }
  }

  // Counts only; no activity data or token material.
  // bearer:disable javascript_lang_logger_leak
  log.info({ context: "strava", userId, ...counts, total: items.length }, "strava.reconcile.ok");
  return counts;
}
