/**
 * Health Connect sync: the Android app reads exercise sessions from Health
 * Connect (with its Changes API) and posts them here. The import follows the
 * Garmin path: dedupe on the session's own id, drop sessions another source
 * already gave us, then insert standalone rows with their synthesised set.
 *
 * Source priority, highest first: Strava, Garmin, Health Connect.
 *   - A session written to Health Connect by the Strava or Garmin Connect app,
 *     while that provider is connected here, is skipped: its own sync brings
 *     it in with more detail.
 *   - A session matching (same start, length and sport) a stored Strava or
 *     Garmin recording, or another Health Connect import (two apps writing
 *     the same run), is skipped.
 *   - A Strava or Garmin sync that later brings in a session already imported
 *     from Health Connect supersedes it (supersedeHealthConnectRecordings).
 *
 * Deletions the Changes API reports move the matching imports to the recycle
 * bin, unless the athlete has taken the row over (a plan day or an RPE).
 */
import type { HealthConnectSessionInput, HealthConnectSyncInput, WorkoutLog } from "@shared/schema";
import type { DistanceUnit, UnitPreferences } from "@shared/unitConversion";

import { db } from "../db";
import { storage } from "../storage";
import { dropCrossProviderDuplicates, isSameRecording, recordingTimingFromLog } from "./crossProviderDuplicates";
import { recordingSetRow } from "./deviceActivitySets";
import {
  healthConnectRecordingMeasurements,
  type HealthConnectWorkoutRow,
  mapHealthConnectSessionToWorkout,
} from "./healthConnectMapper";

/** Apps whose Health Connect sessions a connected provider's own sync imports. */
export const PROVIDER_APP_PACKAGES = {
  strava: "com.strava",
  garmin: "com.garmin.android.apps.connectmobile",
} as const;

export interface HealthConnectSyncResult {
  imported: number;
  skipped: number;
  deleted: number;
}

interface Pending {
  session: HealthConnectSessionInput;
  row: HealthConnectWorkoutRow;
}

/** Keeps the first of any sessions in the batch that are the same recording. */
export function dropBatchDuplicates(items: readonly Pending[]): Pending[] {
  const kept: Pending[] = [];
  for (const item of items) {
    const timing = recordingTimingFromLog(item.row);
    if (!kept.some((other) => isSameRecording(timing, recordingTimingFromLog(other.row)))) kept.push(item);
  }
  return kept;
}

export async function importHealthConnectSessions(userId: string, input: HealthConnectSyncInput): Promise<HealthConnectSyncResult> {
  const user = await storage.users.getUser(userId);
  const preferences: UnitPreferences = { weightUnit: user?.weightUnit, distanceUnit: user?.distanceUnit };
  const deleted = await storage.workouts.binWorkoutLogs(
    userId,
    await storage.workouts.findUntouchedHealthConnectLogIds(userId, input.deletedIds),
  );

  const [strava, garmin, existingIds] = await Promise.all([
    storage.users.getStravaConnection(userId),
    storage.users.getGarminConnection(userId),
    storage.workouts.getExistingHealthConnectIds(userId, input.sessions.map((s) => s.id)),
  ]);
  const ownedByProvider = new Set<string>([
    ...(strava ? [PROVIDER_APP_PACKAGES.strava] : []),
    ...(garmin ? [PROVIDER_APP_PACKAGES.garmin] : []),
  ]);
  const known = new Set(existingIds);
  const fresh = input.sessions
    .filter((s) => !known.has(s.id) && !(s.dataOrigin && ownedByProvider.has(s.dataOrigin)))
    .map((session) => ({
      session,
      row: mapHealthConnectSessionToWorkout(session, userId, {
        distanceUnit: (user?.distanceUnit || "km") as DistanceUnit,
        timeZone: user?.userTimezone,
      }),
    }));

  let kept = dropBatchDuplicates(fresh);
  for (const provider of ["strava", "garmin", "health_connect"] as const) {
    kept = (
      await dropCrossProviderDuplicates(userId, kept, provider, (item) => ({
        date: item.row.date,
        timing: recordingTimingFromLog(item.row),
      }))
    ).kept;
  }

  const created = kept.length > 0 ? await insertWithSets(kept, preferences) : [];
  return { imported: created.length, skipped: input.sessions.length - created.length, deleted };
}

/** The rows and their synthesised sets, in one transaction (as the Garmin sync, C26). */
async function insertWithSets(items: readonly Pending[], preferences: UnitPreferences): Promise<WorkoutLog[]> {
  const sessionsById = new Map(items.map((item) => [item.session.id, item.session]));
  return await db.transaction(async (tx) => {
    const logs = await storage.workouts.createHealthConnectWorkoutLogs(
      items.map((item) => item.row),
      tx,
    );
    const sets = logs.flatMap((log) => {
      const session = sessionsById.get(log.healthConnectId ?? "");
      const set = session ? recordingSetRow(log.id, healthConnectRecordingMeasurements(session), preferences) : null;
      return set ? [set] : [];
    });
    await storage.workouts.createDeviceActivitySets(sets, tx);
    return logs;
  });
}
