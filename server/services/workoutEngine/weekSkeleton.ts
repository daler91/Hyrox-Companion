/**
 * The weekly rhythm of a plan: which days train, what each session is for,
 * and which primary lifts it carries.
 *
 * A plan generated in parallel chunks has no other way to keep one rhythm —
 * left to the model, Monday was lower-body strength in weeks 1-2 and a run in
 * weeks 3-4, because each chunk re-derived the week from scratch. Deciding it
 * here means every week of the plan (deloads included) has the same shape, so
 * the athlete learns it and loads can progress session to session.
 *
 * Two decisions, both deterministic:
 *
 * 1. WHICH sessions: a priority list per goal, cut to the training days. The
 *    first few entries are what the goal cannot do without (a HYROX week with
 *    three days is strength, a threshold run and a station session; a
 *    runner's is a threshold run, a long run and strength), and the strength
 *    sessions split the primary lifts between them — full body, A/B, A/B/C or
 *    upper/lower as the count allows.
 * 2. WHERE they go: every assignment of sessions to the athlete's available
 *    days is scored — hard days back to back, heavy legs in the 48 hours
 *    before a key run, strength days touching, the long run off the weekend —
 *    and the least-penalised one wins. At most 7! arrangements, so it is
 *    searched exhaustively rather than by heuristic.
 */
import { PLAN_WEEKDAYS } from "@shared/dateUtils";
import type { TrainingPhase } from "@shared/nutritionTargets";
import type { ExerciseName } from "@shared/schema/exercises";

import type { GoalLens, PrimarySlot } from "../ai/exerciseKnowledge";

export type Weekday = (typeof PLAN_WEEKDAYS)[number];

export type SessionKind =
  | "strength"
  | "threshold_run"
  | "interval_run"
  | "long_run"
  | "easy_run"
  | "stations"
  | "simulation"
  | "conditioning"
  | "easy_cardio";

export interface SkeletonLift {
  readonly slot: PrimarySlot;
  readonly exercise: ExerciseName;
  /** `light`: the lift's second exposure of the week, at ~90% of its target load. */
  readonly exposure: "main" | "light";
}

export interface SkeletonSession {
  readonly day: Weekday;
  readonly kind: SessionKind;
  readonly label: string;
  readonly lifts: readonly SkeletonLift[];
  /** A short easy run to finish a strength session, when the week needs the running. */
  readonly runFinisher: boolean;
}

export interface WeekSkeleton {
  readonly sessions: readonly SkeletonSession[];
  readonly restDays: readonly Weekday[];
}

/**
 * Sessions per goal, most essential first; a week takes the first N. The same
 * kind appearing twice (two strength sessions) splits that work between them.
 */
const SESSION_PRIORITY: Readonly<Record<GoalLens, readonly SessionKind[]>> = {
  hyrox: [
    "strength",
    "threshold_run",
    "stations",
    "long_run",
    "strength",
    "interval_run",
    "easy_run",
  ],
  running: [
    "threshold_run",
    "long_run",
    "strength",
    "easy_run",
    "interval_run",
    "easy_run",
    "strength",
  ],
  strength: [
    "strength",
    "strength",
    "strength",
    "strength",
    "conditioning",
    "easy_cardio",
    "easy_cardio",
  ],
  hybrid: [
    "strength",
    "threshold_run",
    "long_run",
    "strength",
    "easy_run",
    "interval_run",
    "conditioning",
  ],
  weight_loss: [
    "strength",
    "conditioning",
    "strength",
    "easy_cardio",
    "conditioning",
    "strength",
    "easy_cardio",
  ],
  general: [
    "strength",
    "conditioning",
    "strength",
    "easy_cardio",
    "conditioning",
    "strength",
    "easy_cardio",
  ],
};

const RUN_KINDS: ReadonlySet<SessionKind> = new Set([
  "threshold_run",
  "interval_run",
  "long_run",
  "easy_run",
  "simulation",
]);
/** Sessions whose quality the day before can spoil. */
const KEY_KINDS: ReadonlySet<SessionKind> = new Set([
  "threshold_run",
  "interval_run",
  "long_run",
  "simulation",
]);
const EASY_KINDS: ReadonlySet<SessionKind> = new Set(["easy_run", "easy_cardio"]);
/** HYROX asks for three runs a week; a station session is run-heavy by design. */
const MIN_HYROX_RUNS = 3;

// ---------------------------------------------------------------------------
// Strength splits
// ---------------------------------------------------------------------------

type SplitEntry = readonly [PrimarySlot, "main" | "light"];

interface StrengthSplit {
  readonly label: string;
  readonly slots: readonly SplitEntry[];
}

/**
 * How the primary lifts share out over one to four strength sessions. Knee-
 * dominant work and pressing on one day, hip-dominant work and pulling on the
 * other, is the split that keeps two sessions a week from fighting each other;
 * with three or four sessions the main lifts get a lighter second exposure.
 */
const SPLITS: Readonly<Record<number, readonly StrengthSplit[]>> = {
  1: [
    {
      label: "Strength — full body",
      slots: [
        ["squat", "main"],
        ["hinge", "main"],
        ["horizontal_push", "main"],
        ["vertical_push", "main"],
        ["pull", "main"],
        ["single_leg", "main"],
        ["calves", "main"],
      ],
    },
  ],
  2: [
    {
      label: "Strength A — squat and press",
      slots: [
        ["squat", "main"],
        ["horizontal_push", "main"],
        ["vertical_push", "main"],
        ["calves", "main"],
      ],
    },
    {
      label: "Strength B — hinge and pull",
      slots: [
        ["hinge", "main"],
        ["pull", "main"],
        ["single_leg", "main"],
      ],
    },
  ],
  3: [
    {
      label: "Strength A — squat and bench",
      slots: [
        ["squat", "main"],
        ["horizontal_push", "main"],
        ["calves", "main"],
      ],
    },
    {
      label: "Strength B — hinge, press and pull",
      slots: [
        ["hinge", "main"],
        ["vertical_push", "main"],
        ["pull", "main"],
      ],
    },
    {
      label: "Strength C — volume and single-leg",
      slots: [
        ["squat", "light"],
        ["horizontal_push", "light"],
        ["single_leg", "main"],
      ],
    },
  ],
  4: [
    {
      label: "Lower A — squat",
      slots: [
        ["squat", "main"],
        ["single_leg", "main"],
        ["calves", "main"],
      ],
    },
    {
      label: "Upper A — bench and pull",
      slots: [
        ["horizontal_push", "main"],
        ["pull", "main"],
      ],
    },
    {
      label: "Lower B — hinge",
      slots: [
        ["hinge", "main"],
        ["squat", "light"],
      ],
    },
    {
      label: "Upper B — press and pull",
      slots: [
        ["vertical_push", "main"],
        ["horizontal_push", "light"],
        ["pull", "light"],
      ],
    },
  ],
};

interface PrimaryInput {
  readonly slot: PrimarySlot;
  readonly exercise: ExerciseName;
}

function splitLifts(
  count: number,
  primaries: readonly PrimaryInput[],
): { label: string; lifts: SkeletonLift[] }[] {
  const splits = SPLITS[Math.min(4, Math.max(1, count))] ?? [];
  const bySlot = new Map(primaries.map((lift) => [lift.slot, lift]));
  const sessions = splits.map((split) => ({
    label: split.label,
    lifts: split.slots.flatMap(([slot, exposure]): SkeletonLift[] => {
      const lift = bySlot.get(slot);
      return lift ? [{ slot, exercise: lift.exercise, exposure }] : [];
    }),
  }));
  // A primary whose slot no session lists still has to live somewhere: put it
  // in the lightest session so no backbone lift silently drops out.
  const placed = new Set(sessions.flatMap((session) => session.lifts.map((lift) => lift.slot)));
  for (const lift of primaries) {
    if (placed.has(lift.slot)) continue;
    const lightest = sessions.reduce<(typeof sessions)[number] | undefined>(
      (best, session) => (!best || session.lifts.length < best.lifts.length ? session : best),
      undefined,
    );
    lightest?.lifts.push({ slot: lift.slot, exercise: lift.exercise, exposure: "main" });
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

interface PlannedSession {
  readonly kind: SessionKind;
  readonly label: string;
  readonly lifts: readonly SkeletonLift[];
  readonly runFinisher: boolean;
}

const KIND_LABELS: Readonly<Record<Exclude<SessionKind, "strength">, string>> = {
  threshold_run: "Threshold run",
  interval_run: "Intervals",
  long_run: "Long run",
  easy_run: "Easy run",
  stations: "Stations — compromised running",
  simulation: "Race simulation",
  conditioning: "Conditioning",
  easy_cardio: "Easy aerobic",
};

/** A HYROX week's long session becomes race-specific once the plan peaks. */
function kindForPhase(kind: SessionKind, lens: GoalLens, phase: TrainingPhase): SessionKind {
  if (lens === "hyrox" && kind === "long_run" && (phase === "peak" || phase === "taper")) {
    return "simulation";
  }
  return kind;
}

function planSessions(input: WeekSkeletonInput, count: number): PlannedSession[] {
  const kinds = SESSION_PRIORITY[input.lens]
    .slice(0, count)
    .map((kind) => kindForPhase(kind, input.lens, input.phase));
  const strengthCount = kinds.filter((kind) => kind === "strength").length;
  const strength = splitLifts(strengthCount, input.primaryLifts);
  // A HYROX week short of three runs finishes its strength sessions with one.
  const runs = kinds.filter((kind) => RUN_KINDS.has(kind) || kind === "stations").length;
  const needsRunFinisher = input.lens === "hyrox" && runs < MIN_HYROX_RUNS;

  let strengthIndex = 0;
  return kinds.map((kind): PlannedSession => {
    if (kind !== "strength") {
      return { kind, label: KIND_LABELS[kind], lifts: [], runFinisher: false };
    }
    const session = strength[strengthIndex] ?? { label: "Strength", lifts: [] };
    strengthIndex += 1;
    return { kind, label: session.label, lifts: session.lifts, runFinisher: needsRunFinisher };
  });
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const WEEKEND: ReadonlySet<number> = new Set([5, 6]);

function isHard(session: PlannedSession): boolean {
  return !EASY_KINDS.has(session.kind);
}

function isHeavyLegs(session: PlannedSession): boolean {
  return session.lifts.some(
    (lift) => lift.exposure === "main" && (lift.slot === "squat" || lift.slot === "hinge"),
  );
}

function isGripHeavy(session: PlannedSession): boolean {
  return session.kind === "stations" || session.lifts.some((lift) => lift.slot === "pull");
}

/** The cost of `second` falling the day after `first`. */
function adjacencyPenalty(first: PlannedSession, second: PlannedSession): number {
  let penalty = 0;
  if (isHard(first) && isHard(second)) penalty += 2;
  if (first.kind === "strength" && second.kind === "strength") penalty += 3;
  if (isHeavyLegs(first) && KEY_KINDS.has(second.kind)) penalty += 3;
  // Two quality runs in a row: the second is run on tired legs and loses its point.
  if (KEY_KINDS.has(first.kind) && KEY_KINDS.has(second.kind)) penalty += 2;
  if (KEY_KINDS.has(first.kind) && isHeavyLegs(second)) penalty += 1;
  if (isGripHeavy(first) && isGripHeavy(second)) penalty += 1;
  return penalty;
}

/** Every rule, over one week laid out Monday..Sunday (null = rest). */
function scoreWeek(week: readonly (PlannedSession | null)[], weekendAvailable: boolean): number {
  let penalty = 0;
  for (let day = 0; day < 7; day++) {
    const session = week[day];
    // The week repeats, so Sunday is followed by next Monday.
    const next = week[(day + 1) % 7];
    const afterNext = week[(day + 2) % 7];
    if (!session) {
      // Two rest days together, when the sessions could have been spread out.
      if (!next) penalty += 0.5;
      continue;
    }
    if (next) penalty += adjacencyPenalty(session, next);
    // Heavy legs inside the 48 hours before a key run, not only the day before.
    if (afterNext && isHeavyLegs(session) && KEY_KINDS.has(afterNext.kind)) penalty += 1;
    const long = session.kind === "long_run" || session.kind === "simulation";
    if (long && weekendAvailable && !WEEKEND.has(day)) penalty += 4;
  }
  return penalty;
}

/** k-element subsets of `items`, in lexicographic order. */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  const result: T[][] = [];
  items.forEach((item, index) => {
    for (const rest of combinations(items.slice(index + 1), k - 1)) result.push([item, ...rest]);
  });
  return result;
}

/**
 * Orderings of the sessions in which sessions of the same kind keep their
 * relative order — Strength A always before Strength B — so equivalent
 * arrangements are searched once.
 */
function orderings(sessions: readonly PlannedSession[]): PlannedSession[][] {
  if (sessions.length === 0) return [[]];
  const result: PlannedSession[][] = [];
  const seenKinds = new Set<SessionKind>();
  sessions.forEach((session, index) => {
    // Only the FIRST remaining session of each kind may go next.
    if (seenKinds.has(session.kind)) return;
    seenKinds.add(session.kind);
    const rest = [...sessions.slice(0, index), ...sessions.slice(index + 1)];
    for (const tail of orderings(rest)) result.push([session, ...tail]);
  });
  return result;
}

export interface WeekSkeletonInput {
  readonly lens: GoalLens;
  readonly phase: TrainingPhase;
  readonly daysPerWeek: number;
  /** Days the athlete asked to keep free. */
  readonly restDays?: readonly string[] | null;
  readonly primaryLifts: readonly PrimaryInput[];
}

/**
 * The week's sessions on their days. Deterministic: the same input always
 * returns the same week, so every chunk of a plan shares it.
 */
export function buildWeekSkeleton(input: WeekSkeletonInput): WeekSkeleton {
  const fixedRest = new Set(input.restDays ?? []);
  const available = PLAN_WEEKDAYS.map((_, index) => index).filter(
    (index) => !fixedRest.has(PLAN_WEEKDAYS[index] ?? ""),
  );
  const count = Math.max(0, Math.min(input.daysPerWeek, available.length, 7));
  const sessions = planSessions(input, count);
  const weekendAvailable = available.some((index) => WEEKEND.has(index));

  let best: (PlannedSession | null)[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const days of combinations(available, count)) {
    for (const order of orderings(sessions)) {
      const week: (PlannedSession | null)[] = Array.from({ length: 7 }, () => null);
      days.forEach((day, index) => {
        week[day] = order[index] ?? null;
      });
      const score = scoreWeek(week, weekendAvailable);
      if (score < bestScore) {
        best = week;
        bestScore = score;
      }
    }
  }

  const week = best ?? Array.from({ length: 7 }, () => null);
  const placed: SkeletonSession[] = [];
  const restDays: Weekday[] = [];
  week.forEach((session, index) => {
    const day = PLAN_WEEKDAYS[index];
    if (session) placed.push({ day, ...session });
    else restDays.push(day);
  });
  return { sessions: placed, restDays };
}
