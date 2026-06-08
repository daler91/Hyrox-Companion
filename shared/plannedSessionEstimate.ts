/**
 * Estimate a planned session's duration and intensity from the workout's already
 * saved exercise table — structure blocks (EMOM/AMRAP/for-time/intervals/…) and
 * planned exercise sets. Feeds `computeSessionFuellingTarget` so a planned
 * workout can show a pre-session fuelling target before it's ever logged.
 *
 * Browser-safe and DB-free (mirrors `shared/sessionFuellingTargets.ts`): typed
 * Input/Result, no I/O. The numbers are rough coaching heuristics — the athlete
 * can always override duration/intensity explicitly on the plan day.
 */

/** Block-level timing/intensity fields (a structural subset of StructureBlockInput). */
export interface PlannedSessionBlock {
  formatType?: string | null;
  sectionType?: string | null;
  durationMinutes?: number | null;
  durationSeconds?: number | null;
  timeCapMinutes?: number | null;
  roundCount?: number | null;
  rounds?: number | null;
  workSeconds?: number | null;
  restSeconds?: number | null;
  workIntervalSec?: number | null;
  restIntervalSec?: number | null;
}

/** Set-level fields used when no block carries timing (subset of ExerciseSet). */
export interface PlannedSessionSet {
  /** Prescribed time in seconds; falls back to logged `time` when present. */
  plannedTime?: number | null;
  time?: number | null;
  plannedReps?: number | null;
  reps?: number | null;
}

export interface PlannedSessionEstimateInput {
  structureBlocks?: readonly PlannedSessionBlock[] | null;
  exerciseSets?: readonly PlannedSessionSet[] | null;
}

export interface PlannedSessionEstimate {
  /** Estimated session duration in minutes, or null when nothing usable. */
  durationMin: number | null;
  /** Estimated intensity (RPE 1–10) inferred from block formats, or null. */
  rpe: number | null;
  /** Where the duration estimate came from, for UI transparency. */
  source: "structure" | "sets" | "none";
}

const MIN_DURATION_MIN = 10;
const MAX_DURATION_MIN = 180;
// Rough wall-clock per set (incl. rest) when only a set count is known.
const MINUTES_PER_SET = 3;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Estimate one block's minutes, preferring the most explicit timing signal. */
function blockMinutes(b: PlannedSessionBlock): number {
  if (b.durationMinutes && b.durationMinutes > 0) return b.durationMinutes;
  if (b.durationSeconds && b.durationSeconds > 0) return b.durationSeconds / 60;
  if (b.timeCapMinutes && b.timeCapMinutes > 0) return b.timeCapMinutes;
  // Interval/EMOM-style: rounds × (work + rest).
  const rounds = b.roundCount ?? b.rounds ?? 0;
  const work = b.workSeconds ?? b.workIntervalSec ?? 0;
  const rest = b.restSeconds ?? b.restIntervalSec ?? 0;
  if (rounds > 0 && work + rest > 0) return (rounds * (work + rest)) / 60;
  return 0;
}

/** RPE proxy from a block's format — how glycogen-depleting it tends to be. */
function formatRpe(formatType: string | null | undefined): number | null {
  switch (formatType) {
    case "for_time":
    case "amrap":
      return 8;
    case "emom":
    case "interval":
    case "rounds":
      return 7;
    case "steady":
    case "quality":
      return 5;
    default:
      return null;
  }
}

export function estimatePlannedSession(input: PlannedSessionEstimateInput): PlannedSessionEstimate {
  const blocks = input.structureBlocks ?? [];
  const sets = input.exerciseSets ?? [];

  // --- Duration: prefer structured block timing, else estimate from sets. ---
  const blockTotal = blocks.reduce((acc, b) => acc + blockMinutes(b), 0);
  let durationMin: number | null = null;
  let source: PlannedSessionEstimate["source"] = "none";
  if (blockTotal > 0) {
    durationMin = clamp(Math.round(blockTotal), MIN_DURATION_MIN, MAX_DURATION_MIN);
    source = "structure";
  } else if (sets.length > 0) {
    const setTimeMin = sets.reduce((acc, s) => acc + (s.plannedTime ?? s.time ?? 0), 0) / 60;
    const countMin = sets.length * MINUTES_PER_SET;
    durationMin = clamp(
      Math.round(Math.max(setTimeMin, countMin)),
      MIN_DURATION_MIN,
      MAX_DURATION_MIN,
    );
    source = "sets";
  }

  // --- Intensity: hardest "main" block format, else hardest of any block. ---
  const rpeOf = (filter: (b: PlannedSessionBlock) => boolean): number[] =>
    blocks
      .filter(filter)
      .map((b) => formatRpe(b.formatType))
      .filter((r): r is number => r != null);
  const mainRpes = rpeOf((b) => b.sectionType === "main");
  const pool = mainRpes.length > 0 ? mainRpes : rpeOf(() => true);
  const rpe = pool.length > 0 ? Math.max(...pool) : null;

  return { durationMin, rpe, source };
}
