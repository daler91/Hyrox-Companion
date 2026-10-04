/**
 * Cross-provider duplicate guard (D16, CODEBASE_ANALYSIS_2026-10-03).
 *
 * A Garmin watch that auto-uploads to Strava, with both connected here, hands
 * the app every session twice: once from each sync, under two unrelated
 * activity ids. Each sync dedups only on its own provider's id, so both rows
 * landed and weekly totals, session counts, calories and training load all
 * counted the session twice. Before importing, each sync now asks whether
 * the OTHER provider already gave us this recording, and skips it if so.
 *
 * Conservative on purpose, because a false merge drops a real session while
 * a missed one only leaves a duplicate the athlete can delete. Two recordings
 * count as one only when they start within two minutes of each other, ran
 * about as long, and are not plainly different sports. One athlete cannot
 * start two sessions of the same length at the same moment, so a pair like
 * that is one workout seen twice (including one recorded on two devices).
 *
 * Skipping, rather than putting the second id on the first row, keeps the
 * one-recording-per-row invariant deviceActivityLink.ts relies on. The skip
 * is re-decided on every sync, so it holds for as long as the other
 * provider's row exists.
 */
import type { StravaActivitySummary, WorkoutLog } from "@shared/schema";

import { storage } from "../storage";
import { classifyDeviceSport, type DeviceSportKind } from "./deviceActivityMatcher";

export type DeviceProvider = "strava" | "garmin";

/** When a recording started and how long it ran, as either provider reports it. */
export interface RecordingTiming {
  /** True start instant, epoch ms; null when the provider gave none. */
  startMs: number | null;
  /** Moving time in seconds; null when unknown. */
  movingTimeSec: number | null;
  /** Provider sport type ("Run", "running"). */
  sportType: string | null;
}

/** Same FIT file, or two devices started together: the starts agree to the minute. */
export const SAME_RECORDING_START_TOLERANCE_MS = 2 * 60 * 1000;
/** Providers compute moving time differently, so allow the larger of these. */
const SAME_RECORDING_DURATION_TOLERANCE_SEC = 2 * 60;
const SAME_RECORDING_DURATION_TOLERANCE_RATIO = 0.1;

/** What a provider calls a session it cannot name; it never rules a pair out. */
const GENERIC_SPORT_KINDS: ReadonlySet<DeviceSportKind> = new Set(["other", "conditioning"]);

function sportsAgree(a: string | null, b: string | null): boolean {
  const kindA = classifyDeviceSport(a);
  const kindB = classifyDeviceSport(b);
  return kindA === kindB || GENERIC_SPORT_KINDS.has(kindA) || GENERIC_SPORT_KINDS.has(kindB);
}

export function isSameRecording(a: RecordingTiming, b: RecordingTiming): boolean {
  if (a.startMs == null || b.startMs == null) return false;
  if (Math.abs(a.startMs - b.startMs) > SAME_RECORDING_START_TOLERANCE_MS) return false;
  if (!a.movingTimeSec || !b.movingTimeSec) return false;
  const tolerance = Math.max(
    SAME_RECORDING_DURATION_TOLERANCE_SEC,
    SAME_RECORDING_DURATION_TOLERANCE_RATIO * Math.max(a.movingTimeSec, b.movingTimeSec),
  );
  if (Math.abs(a.movingTimeSec - b.movingTimeSec) > tolerance) return false;
  return sportsAgree(a.sportType, b.sportType);
}

function epochMsOrNull(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function recordingTimingFromStrava(
  activity: Pick<StravaActivitySummary, "start_date" | "moving_time" | "sport_type" | "type">,
): RecordingTiming {
  return {
    startMs: epochMsOrNull(activity.start_date),
    movingTimeSec: activity.moving_time ?? null,
    sportType: activity.sport_type || activity.type || null,
  };
}

/**
 * A stored row's recording. A Strava link snapshot is preferred: on a log the
 * athlete wrote, `duration` may be the number they typed rather than the
 * recording's. Garmin rows (and Strava rows from before the snapshot) fall
 * back to the columns; `duration` is whole minutes, well inside the tolerance.
 */
export function recordingTimingFromLog(
  row: Pick<WorkoutLog, "startedAt" | "duration" | "focus"> &
    Partial<Pick<WorkoutLog, "deviceActivity">>,
): RecordingTiming {
  const raw = row.deviceActivity?.raw;
  if (raw) return recordingTimingFromStrava(raw);
  return {
    startMs: epochMsOrNull(row.startedAt),
    movingTimeSec: row.duration != null ? row.duration * 60 : null,
    sportType: row.focus,
  };
}

export interface IncomingRecording {
  /** The athlete's local calendar date, as the row would be stored. */
  date: string;
  timing: RecordingTiming;
}

/**
 * Drop the incoming recordings that `existingProvider` already gave us. One
 * query for the whole batch. Each stored row absorbs at most one incoming
 * recording, so a genuinely separate second session is never swallowed by a
 * row that already accounts for another.
 */
export async function dropCrossProviderDuplicates<T>(
  userId: string,
  incoming: readonly T[],
  existingProvider: DeviceProvider,
  describe: (item: T) => IncomingRecording,
): Promise<{ kept: T[]; duplicates: number }> {
  if (incoming.length === 0) return { kept: [], duplicates: 0 };
  const described = incoming.map(describe);
  const dates = Array.from(new Set(described.map((d) => d.date)));
  const existing = (
    await storage.workouts.listDeviceRecordingsForDates(userId, dates, existingProvider)
  ).map(recordingTimingFromLog);

  const claimed = new Set<number>();
  const kept: T[] = [];
  incoming.forEach((item, index) => {
    const match = existing.findIndex(
      (timing, i) => !claimed.has(i) && isSameRecording(described[index].timing, timing),
    );
    if (match === -1) kept.push(item);
    else claimed.add(match);
  });
  return { kept, duplicates: incoming.length - kept.length };
}
