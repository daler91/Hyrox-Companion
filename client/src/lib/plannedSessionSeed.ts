import { estimatePlannedSession, type PlannedSessionEstimate } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";

/**
 * The duration and RPE a planned session's fuelling starts from, before any
 * value the athlete saved. The timeline sends `sessionEstimate` on upcoming
 * planned days, personalised by the athlete's recent run pace; the local
 * estimate from the exercise table, which cannot know that pace, is the
 * fallback for an entry without one.
 *
 * The fuelling chip on the card and the fuelling panel in the sheet both start
 * here. The chip used to run only the local estimate while the panel moved on
 * to the server's, so the two could quote different targets (tech debt #59).
 */
export function plannedSessionSeed(
  entry: Pick<TimelineEntry, "sessionEstimate" | "structureBlocks" | "exerciseSets">,
  distanceUnit: string | null,
): PlannedSessionEstimate {
  return (
    entry.sessionEstimate ??
    estimatePlannedSession({
      structureBlocks: entry.structureBlocks ?? [],
      exerciseSets: entry.exerciseSets ?? [],
      distanceUnit,
    })
  );
}
