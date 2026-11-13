import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";

import { storage } from "../../storage";
import { getRunPaceRatio } from "./runPace";

/** A plan day still to come: the cards the fuelling chip sits on (the web's isPlannedTimelineEntry). */
function isUpcomingPlanned(entry: TimelineEntry): boolean {
  return entry.status === "planned" && Boolean(entry.planDayId);
}

/**
 * Adds `sessionEstimate` to each upcoming planned entry: the duration and RPE
 * its prescription implies, personalised by the athlete's recent run pace. A
 * fuelling target falls back on it when the athlete hasn't set an expected
 * duration or RPE (the app's fuelling chip on each planned card, which can't
 * run the estimate itself). Deterministic only: the per-day AI nudge stays
 * with GET /nutrition/planned-session-estimate/{planDayId}.
 */
export async function withSessionEstimates(userId: string, entries: TimelineEntry[]): Promise<TimelineEntry[]> {
  if (!entries.some(isUpcomingPlanned)) return entries;

  const [user, runPaceRatio] = await Promise.all([
    // The unit only reads a distance set with no unit stamp; a failed read falls back to km.
    storage.users.getUser(userId).catch(() => undefined),
    getRunPaceRatio(userId),
  ]);
  const distanceUnit = user?.distanceUnit ?? "km";

  return entries.map((entry) =>
    isUpcomingPlanned(entry)
      ? {
          ...entry,
          sessionEstimate: estimatePlannedSession({
            structureBlocks: entry.structureBlocks,
            exerciseSets: entry.exerciseSets,
            distanceUnit,
            runPaceRatio,
          }),
        }
      : entry,
  );
}
