import { isRestLikePlanDay } from "./planDayKind";

/**
 * What a planned run was FOR — the yardstick session grading measures the
 * recording against ("did the session do its job?").
 *
 * Plan days carry no session-type column: the purpose lives in free text (the
 * `focus` title, the `main_workout` prescription) and in the exercise keys the
 * day's sets were parsed into. So this reads all three, in order of how
 * directly each states the purpose:
 *
 *  1. The title. "Threshold Run", "Easy Run", "Long Run" name what the session
 *     is for — the same reasoning as shared/sessionPriority.ts, which also reads
 *     only the title.
 *  2. The running exercise keys (`tempo_run`, `easy_run`, …) when the title is
 *     generic ("Run", "Cardio"). Not first: a threshold session's reps are
 *     sometimes parsed as `interval_run`, and the title is the athlete's (or
 *     the engine's) own word for it.
 *  3. The prescription text, where threshold words win because threshold
 *     text always mentions its easy warm-up.
 *
 * Only `easy`/`recovery`/`long` and `threshold` are graded today
 * (`gradingIntentFor`). Intervals, steady and race efforts are recognised so
 * they are NOT mistaken for one of those — adding a grader for them later is a
 * new intent plus a mapping here.
 *
 * A leaf module (no `@shared/schema` import) so the client can use it without
 * the drizzle graph — see shared/weeklyReview.ts.
 */

export type RunPurpose = "easy" | "recovery" | "long" | "threshold" | "intervals" | "steady" | "race";
export type SessionGradeIntent = "easy" | "threshold";
export type RunPurposeSource = "title" | "exercise" | "text";

export interface RunPurposeResult {
  purpose: RunPurpose | null;
  source: RunPurposeSource | null;
  /** Plain words for the grade card: why we think this was the session's purpose. */
  reason: string | null;
  /**
   * A long run's final minutes at a harder pace ("last 15 min @ 5:10/km"). The
   * easy grade leaves them out rather than calling the finish a failure.
   */
  hardFinishMinutes: number | null;
}

export interface RunPurposeInput {
  readonly focus?: string | null;
  readonly mainWorkout?: string | null;
  /** Exercise keys of the plan day's prescribed sets. */
  readonly exerciseNames?: readonly string[];
}

/** The purpose in the words the grade card and chips use. */
export function runPurposeLabel(purpose: RunPurpose): string {
  switch (purpose) {
    case "easy":
      return "Easy run";
    case "recovery":
      return "Recovery run";
    case "long":
      return "Long run";
    case "threshold":
      return "Threshold run";
    case "intervals":
      return "Intervals";
    case "steady":
      return "Steady run";
    case "race":
      return "Race effort";
  }
}

const NONE: RunPurposeResult = { purpose: null, source: null, reason: null, hardFinishMinutes: null };

// Whole-word patterns, each flat (no nested quantifiers), matched against
// lower-cased text with collapsed whitespace.
const RACE = [/\brace\b/, /\btime trial\b/, /\bsimulation\b/, /\bhyrox sim\b/, /\bparkrun\b/, /\bbenchmark\b/];
const THRESHOLD = [/\bthreshold\b/, /\btempo\b/, /\blactate\b/, /\blt[12]?\b/, /\bcruise\b/, /\bcomfortably hard\b/];
const INTERVALS = [/\bintervals?\b/, /\brepeats?\b/, /\bvo2/, /\btrack\b/, /\bfartlek\b/, /\breps\b/];
const STEADY = [/\bsteady\b/, /\bmarathon pace\b/, /\bprogression\b/, /\bfast finish\b/];
const LONG = [/\blong run\b/, /\blsd\b/];
const RECOVERY = [/\brecovery\b/, /\bshake ?out\b/, /\bflush\b/];
const EASY = [/\beasy\b/, /\bzone ?2\b/, /\bz2\b/, /\baerobic\b/, /\bconversational\b/, /\bmaf\b/, /\bbase run\b/];
/** "3 x 10 min", "5×1000 m", "6 x 1 km" — a rep structure. */
const REP_STRUCTURE = /\b\d{1,2} ?[x×] ?\d{1,4} ?(?:min|m|km|mi|s)\b/;
/** "last 15 min" of a long run. */
const LAST_MINUTES = /\blast (\d{1,3}) ?min/;
/** A run named by its sport and nothing else, which says nothing about intent. */
const RUN_WORD = /\brun(?:ning)?\b/;

/** Running exercise keys, most intense first: a day listing tempo and easy work is a tempo day. */
const EXERCISE_PURPOSES: readonly (readonly [string, RunPurpose])[] = [
  ["interval_run", "intervals"],
  ["hill_repeats", "intervals"],
  ["fartlek_run", "intervals"],
  ["run_1k", "intervals"],
  ["tempo_run", "threshold"],
  ["long_run", "long"],
  ["recovery_run", "recovery"],
  ["easy_run", "easy"],
];

function normalise(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hardFinishOf(mainWorkout: string): number | null {
  const match = LAST_MINUTES.exec(mainWorkout);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes > 0 ? minutes : null;
}

/**
 * A long run with a harder finish stays a long run only when we know how long
 * the finish is; "progression" or "fast finish" with no length cannot be
 * split off an easy grade, so it reads as a steady run (not graded).
 */
function resolveLong(source: RunPurposeSource, reason: string, mainWorkout: string): RunPurposeResult {
  const finish = hardFinishOf(mainWorkout);
  if (finish !== null) return { purpose: "long", source, reason, hardFinishMinutes: finish };
  if (matchesAny(mainWorkout, STEADY) || matchesAny(mainWorkout, THRESHOLD)) {
    return { purpose: "steady", source, reason, hardFinishMinutes: null };
  }
  return { purpose: "long", source, reason, hardFinishMinutes: null };
}

function fromTitle(title: string, mainWorkout: string): RunPurposeResult | null {
  const reason = "The plan day is titled for it";
  if (matchesAny(title, RACE)) return { purpose: "race", source: "title", reason, hardFinishMinutes: null };
  if (matchesAny(title, LONG)) {
    // "Long run with tempo finish" is a steady long run, not a threshold session.
    if (matchesAny(title, THRESHOLD) || matchesAny(title, STEADY)) {
      return { purpose: "steady", source: "title", reason, hardFinishMinutes: null };
    }
    return resolveLong("title", reason, mainWorkout);
  }
  // Threshold before intervals, so "Threshold intervals" is a threshold session.
  if (matchesAny(title, THRESHOLD)) return { purpose: "threshold", source: "title", reason, hardFinishMinutes: null };
  if (matchesAny(title, INTERVALS)) return { purpose: "intervals", source: "title", reason, hardFinishMinutes: null };
  if (matchesAny(title, STEADY)) return { purpose: "steady", source: "title", reason, hardFinishMinutes: null };
  if (matchesAny(title, RECOVERY)) return { purpose: "recovery", source: "title", reason, hardFinishMinutes: null };
  if (matchesAny(title, EASY)) return { purpose: "easy", source: "title", reason, hardFinishMinutes: null };
  return null;
}

function fromExercises(names: readonly string[], mainWorkout: string): RunPurposeResult | null {
  const present = new Set(names);
  const hit = EXERCISE_PURPOSES.find(([key]) => present.has(key));
  if (!hit) return null;
  const [, purpose] = hit;
  const reason = "The plan day's exercises say so";
  if (purpose === "long") return resolveLong("exercise", reason, mainWorkout);
  return { purpose, source: "exercise", reason, hardFinishMinutes: null };
}

function fromText(text: string): RunPurposeResult | null {
  const reason = "The plan day's prescription describes it";
  if (matchesAny(text, THRESHOLD)) return { purpose: "threshold", source: "text", reason, hardFinishMinutes: null };
  if (REP_STRUCTURE.test(text) || matchesAny(text, INTERVALS)) {
    return { purpose: "intervals", source: "text", reason, hardFinishMinutes: null };
  }
  if (matchesAny(text, LONG)) return resolveLong("text", reason, text);
  if (matchesAny(text, STEADY)) return { purpose: "steady", source: "text", reason, hardFinishMinutes: null };
  if (matchesAny(text, RECOVERY)) return { purpose: "recovery", source: "text", reason, hardFinishMinutes: null };
  // Easy words only count when the text is about running at all.
  if (matchesAny(text, EASY) && RUN_WORD.test(text)) {
    return { purpose: "easy", source: "text", reason, hardFinishMinutes: null };
  }
  return null;
}

export function classifyRunPurpose(input: RunPurposeInput): RunPurposeResult {
  const focus = input.focus ?? "";
  const mainWorkout = input.mainWorkout ?? "";
  if (isRestLikePlanDay(focus, mainWorkout)) return NONE;
  const title = normalise(focus);
  const text = normalise(mainWorkout);
  return (
    fromTitle(title, text) ??
    fromExercises(input.exerciseNames ?? [], text) ??
    fromText(text) ??
    NONE
  );
}

/** The grader a purpose is measured by, or null when we do not grade it yet. */
export function gradingIntentFor(purpose: RunPurpose | null): SessionGradeIntent | null {
  switch (purpose) {
    case "easy":
    case "recovery":
    case "long":
      return "easy";
    case "threshold":
      return "threshold";
    default:
      return null;
  }
}
