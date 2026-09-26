import {
  type DeviceActivitySnapshot,
  planDays,
  type SessionStreamSamples,
  type SessionStreamStatus,
  stravaConnections,
  workoutLogs,
  type WorkoutLogStream,
  workoutLogStreams,
} from "@shared/schema";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";

/**
 * A plan-linked Strava run whose stream has not been fetched yet (or whose
 * last fetch failed and is due a retry). Carries what the fetcher needs to
 * decide, without another query, whether the run is worth a Strava read.
 */
export interface PendingStreamCandidate {
  workoutLogId: string;
  stravaActivityId: string;
  date: string;
  logFocus: string;
  deviceActivity: DeviceActivitySnapshot | null;
  planDayId: string;
  planFocus: string;
  planMainWorkout: string;
  /** Failed attempts already spent on this activity; 0 when there is no row or it is stale. */
  attempts: number;
}

export interface PendingStreamWindow {
  /** Oldest log date (YYYY-MM-DD) worth fetching. */
  since: string;
  /** A failed row is retried only once its last attempt is older than this. */
  retryBefore: Date;
  maxAttempts: number;
  limit: number;
}

export interface SessionStreamResult {
  userId: string;
  workoutLogId: string;
  stravaActivityId: string;
  status: SessionStreamStatus;
  samples: SessionStreamSamples | null;
  /** Failed attempts after this one. */
  attempts: number;
  lastError: string | null;
}

/**
 * Compact heart-rate/pace streams behind session grading.
 *
 * Every per-athlete method is scoped by `user_id` in SQL. The two
 * cross-athlete methods (`countAttemptsSince`, `listUsersWithPendingStreams`)
 * return counts and user ids only — they exist for the fetcher's shared
 * Strava read budget and the backfill scan.
 */
export class SessionStreamStorage {
  async getForLogs(userId: string, workoutLogIds: readonly string[]): Promise<Map<string, WorkoutLogStream>> {
    if (workoutLogIds.length === 0) return new Map();
    const rows = await db
      .select()
      .from(workoutLogStreams)
      .where(
        and(
          eq(workoutLogStreams.userId, userId),
          inArray(workoutLogStreams.workoutLogId, [...workoutLogIds]),
        ),
      );
    return new Map(rows.map((row) => [row.workoutLogId, row]));
  }

  /**
   * Record the outcome of one fetch. An upsert on the log: a refetch after a
   * relink or a retry replaces the row rather than adding a second one.
   */
  async upsertResult(result: SessionStreamResult): Promise<void> {
    const now = new Date();
    const fetched = result.status !== "failed" && result.status !== "skipped";
    const values = {
      stravaActivityId: result.stravaActivityId,
      status: result.status,
      attempts: result.attempts,
      bucketSeconds: result.samples?.bucketSeconds ?? null,
      samples: result.samples,
      lastError: result.lastError,
      lastAttemptAt: now,
      fetchedAt: fetched ? now : null,
    };
    await db
      .insert(workoutLogStreams)
      .values({ ...values, userId: result.userId, workoutLogId: result.workoutLogId })
      .onConflictDoUpdate({ target: workoutLogStreams.workoutLogId, set: values });
  }

  /**
   * Strava reads spent on streams since `since`, across every athlete — the
   * soft ledger that keeps stream fetching inside its share of the app's
   * read budget. `skipped` rows cost no read and are not counted.
   */
  async countAttemptsSince(since: Date): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workoutLogStreams)
      .where(and(gt(workoutLogStreams.lastAttemptAt, since), ne(workoutLogStreams.status, "skipped")));
    return row?.count ?? 0;
  }

  /** Newest first, so the runs the athlete is most likely to open are fetched first. */
  async listPendingForUser(userId: string, window: PendingStreamWindow): Promise<PendingStreamCandidate[]> {
    const rows = await db
      .select({
        workoutLogId: workoutLogs.id,
        stravaActivityId: workoutLogs.stravaActivityId,
        date: workoutLogs.date,
        logFocus: workoutLogs.focus,
        deviceActivity: workoutLogs.deviceActivity,
        planDayId: planDays.id,
        planFocus: planDays.focus,
        planMainWorkout: planDays.mainWorkout,
        streamActivityId: workoutLogStreams.stravaActivityId,
        attempts: workoutLogStreams.attempts,
      })
      .from(workoutLogs)
      .innerJoin(planDays, eq(planDays.id, workoutLogs.planDayId))
      .leftJoin(workoutLogStreams, eq(workoutLogStreams.workoutLogId, workoutLogs.id))
      .where(and(eq(workoutLogs.userId, userId), pendingStreamPredicate(window)))
      .orderBy(desc(workoutLogs.date), desc(workoutLogs.id))
      .limit(window.limit);

    return rows.flatMap((row) => {
      if (!row.stravaActivityId) return [];
      const stale = row.streamActivityId !== null && row.streamActivityId !== row.stravaActivityId;
      return [
        {
          workoutLogId: row.workoutLogId,
          stravaActivityId: row.stravaActivityId,
          date: row.date,
          logFocus: row.logFocus,
          deviceActivity: row.deviceActivity ?? null,
          planDayId: row.planDayId,
          planFocus: row.planFocus,
          planMainWorkout: row.planMainWorkout,
          attempts: stale ? 0 : (row.attempts ?? 0),
        },
      ];
    });
  }

  /**
   * Athletes with at least one pending stream and a Strava connection that
   * still works, most recently active first. User ids only.
   */
  async listUsersWithPendingStreams(window: PendingStreamWindow): Promise<string[]> {
    const rows = await db
      .select({ userId: workoutLogs.userId })
      .from(workoutLogs)
      .innerJoin(planDays, eq(planDays.id, workoutLogs.planDayId))
      .innerJoin(
        stravaConnections,
        and(eq(stravaConnections.userId, workoutLogs.userId), eq(stravaConnections.requiresReauth, false)),
      )
      .leftJoin(workoutLogStreams, eq(workoutLogStreams.workoutLogId, workoutLogs.id))
      .where(pendingStreamPredicate(window))
      .groupBy(workoutLogs.userId)
      .orderBy(desc(sql`max(${workoutLogs.date})`))
      .limit(window.limit);
    return rows.map((row) => row.userId);
  }

  /** Strava disconnect: the streams came from Strava, so they leave with it. */
  async deleteForUser(userId: string): Promise<void> {
    await db.delete(workoutLogStreams).where(eq(workoutLogStreams.userId, userId));
  }

  /** Unlink: the recording is no longer this log's, so neither is its stream. */
  async deleteForLog(workoutLogId: string, userId: string, executor: DbExecutor = db): Promise<void> {
    await executor
      .delete(workoutLogStreams)
      .where(and(eq(workoutLogStreams.workoutLogId, workoutLogId), eq(workoutLogStreams.userId, userId)));
  }

  /**
   * A log just (re)linked to a plan day may now be a gradeable run: drop a
   * `skipped` verdict made against its previous day so the fetcher looks
   * again. Fetched rows stay — the stream does not depend on the plan day.
   */
  async clearSkippedForLog(workoutLogId: string, userId: string): Promise<void> {
    await db
      .delete(workoutLogStreams)
      .where(
        and(
          eq(workoutLogStreams.workoutLogId, workoutLogId),
          eq(workoutLogStreams.userId, userId),
          eq(workoutLogStreams.status, "skipped"),
        ),
      );
  }
}

/**
 * A plan-linked Strava log inside the window whose stream is missing, was
 * fetched for a different activity (the log was relinked), or failed and is
 * due a retry. Shared by the per-athlete list and the backfill scan so the
 * two can never disagree about what "pending" means.
 */
function pendingStreamPredicate(window: PendingStreamWindow) {
  return and(
    isNotNull(workoutLogs.stravaActivityId),
    isNotNull(workoutLogs.planDayId),
    gte(workoutLogs.date, window.since),
    or(
      isNull(workoutLogStreams.id),
      ne(workoutLogStreams.stravaActivityId, workoutLogs.stravaActivityId),
      and(
        eq(workoutLogStreams.status, "failed"),
        lt(workoutLogStreams.attempts, window.maxAttempts),
        lt(workoutLogStreams.lastAttemptAt, window.retryBefore),
      ),
    ),
  );
}
