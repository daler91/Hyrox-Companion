/**
 * The one call every path that links a Strava recording to a plan day makes,
 * so the run's HR/pace stream is fetched for session grading.
 *
 * Best-effort by design: the link the athlete asked for has already been
 * written, and a queue or cache blip must never turn it into an error. The
 * backfill scan (sessionStreamSync.ts) picks up anything this misses.
 */
import type { WorkoutLog } from "@shared/schema";

import { logger } from "../logger";
import type { IStorage } from "../storage";
import { enqueueSessionStreams, type SessionStreamTrigger } from "./sessionStreamQueue";

type LinkedLog = Pick<WorkoutLog, "id" | "planDayId" | "stravaActivityId">;

export async function requestSessionStreamForLog(
  storage: IStorage,
  userId: string,
  log: LinkedLog | null | undefined,
  trigger: SessionStreamTrigger,
): Promise<void> {
  if (!log?.planDayId || !log.stravaActivityId) return;
  try {
    // A `skipped` verdict was made against the run's previous plan day.
    await storage.sessionStreams.clearSkippedForLog(log.id, userId);
    await enqueueSessionStreams(userId, trigger);
  } catch (err) {
    // err is a queue/DB error; no activity data.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ context: "session-streams", err, trigger }, "Failed to queue a session stream (non-fatal)");
  }
}
