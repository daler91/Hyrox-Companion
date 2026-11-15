import { cadenceUnitFor } from "@shared/deviceSportTypes";
import { computeMafCompliance } from "@shared/maf";
import { isRestLikePlanDay } from "@shared/planDayKind";
import { RACE_DAY_FOCUS } from "@shared/raceDay";
import {
  type CadenceUnit,
  isRunningExerciseName,
  type SessionMafCompliance,
  type TimelineDayKind,
  type TimelineEntry,
  type WorkoutLog,
} from "@shared/schema";

/**
 * Values a client would otherwise work out from a session itself, worked out
 * here once so the web's rules aren't copied into the app
 * (docs/mobile-shared-logic.md, API fields 3b, 7 and 8).
 */

/** What the MAF score needs to know about the athlete. */
export interface MafAthlete {
  readonly trainingStyleId?: string | null;
  readonly mafHr?: number | null;
}

/** The athlete's MAF ceiling, or null unless they train the MAF method and have one (getMafCeiling). */
export function mafCeilingOf(athlete: MafAthlete | null | undefined): number | null {
  if (athlete?.trainingStyleId !== "maf_method") return null;
  return athlete.mafHr ?? null;
}

interface ScoredSession {
  readonly status?: string;
  readonly avgHeartrate?: number | null;
  readonly maxHeartrate?: number | null;
  readonly exerciseSets?: ReadonlyArray<{ readonly exerciseName: string }>;
}

/**
 * How a completed session's average heart rate sat against [ceiling], or null
 * when there is nothing to score: no ceiling, no average, or no running in the
 * session (an average of 165 on wall balls is wall balls, not a MAF miss — the
 * web's WorkoutSummaryHeader gate).
 */
export function sessionMafCompliance(session: ScoredSession, ceiling: number | null): SessionMafCompliance | null {
  const avgHeartRate = session.avgHeartrate;
  if (ceiling == null || avgHeartRate == null || avgHeartRate <= 0) return null;
  if (session.status != null && session.status !== "completed") return null;
  if (!session.exerciseSets?.some((set) => isRunningExerciseName(set.exerciseName))) return null;
  const result = computeMafCompliance({ avgHeartRate, maxHeartRate: session.maxHeartrate ?? null, ceiling });
  return {
    compliancePct: result.compliancePct,
    classification: result.classification,
    nextAction: result.nextAction,
    avgOverBy: result.details.avgOverBy,
  };
}

/**
 * The recording's sport type ("Run", "Ride"): from the link snapshot, or the
 * `focus` of a standalone import from before the snapshot column (see
 * legacyRawFromLog) -- C9 (CODEBASE_ANALYSIS_2026-10-03).
 */
export function deviceSportTypeOf(log: Pick<WorkoutLog, "deviceActivity" | "source" | "focus">): string | null {
  return log.deviceActivity?.raw?.sport_type ?? (log.source === "strava" ? log.focus : null);
}

/** The unit [avgCadence] is in, or null without a cadence to label. */
export function avgCadenceUnitFor(avgCadence: number | null | undefined, sportType: string | null | undefined): CadenceUnit | null {
  return avgCadence == null ? null : cadenceUnitFor(sportType);
}

/**
 * The race by its marker (an exact, case-insensitive match, so "Race Pace" is
 * a session), a rest day by its wording on a planned day, otherwise a session.
 */
export function timelineDayKind(entry: Pick<TimelineEntry, "type" | "focus" | "mainWorkout">): TimelineDayKind {
  if ((entry.focus ?? "").trim().toLowerCase() === RACE_DAY_FOCUS.toLowerCase()) return "race";
  if (entry.type === "planned" && isRestLikePlanDay(entry.focus ?? "", entry.mainWorkout ?? "")) return "rest";
  return "session";
}

/** Adds `dayKind` to every entry, and `avgCadenceUnit` and `mafCompliance` where they apply. */
export function withSessionDerivedFields(entries: TimelineEntry[], athlete: MafAthlete | null | undefined): TimelineEntry[] {
  const ceiling = mafCeilingOf(athlete);
  return entries.map((entry) => {
    const avgCadenceUnit = avgCadenceUnitFor(entry.avgCadence, entry.deviceSportType);
    const mafCompliance = entry.type === "logged" ? sessionMafCompliance(entry, ceiling) : null;
    return {
      ...entry,
      dayKind: timelineDayKind(entry),
      ...(avgCadenceUnit ? { avgCadenceUnit } : {}),
      ...(mafCompliance ? { mafCompliance } : {}),
    };
  });
}

/** A logged workout's `avgCadenceUnit` and `mafCompliance`, each only where it applies (GET /api/v1/workouts/{id}). */
export function workoutDerivedFields(
  log: WorkoutLog,
  exerciseSets: ReadonlyArray<{ readonly exerciseName: string }>,
  athlete: MafAthlete | null | undefined,
): { avgCadenceUnit?: CadenceUnit; mafCompliance?: SessionMafCompliance } {
  const avgCadenceUnit = avgCadenceUnitFor(log.avgCadence, deviceSportTypeOf(log));
  const mafCompliance = sessionMafCompliance({ ...log, status: "completed", exerciseSets }, mafCeilingOf(athlete));
  return { ...(avgCadenceUnit ? { avgCadenceUnit } : {}), ...(mafCompliance ? { mafCompliance } : {}) };
}
