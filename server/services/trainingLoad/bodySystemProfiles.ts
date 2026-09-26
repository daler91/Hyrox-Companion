// Load by body system: what each exercise loads.
//
// Every exercise gets a profile: for each of the four systems, the share of
// the exercise's effort (0-1) that system bears. The shares are NOT a
// partition and do not sum to 1, because one minute of work loads several
// systems at once: a minute of running is a full minute for the heart and
// lungs AND a full minute of foot-strike, while the leg muscles carry part of
// it. The same idea as differential RPE, which rates breathlessness and leg
// and upper-body muscle exertion separately for one session (McLaren et al.
// 2017); the app only collects one rating, so the split comes from what the
// session contained.
//
// Each system is only ever compared with its OWN history, never with another
// system, so a profile has to be consistent from week to week rather than
// calibrated across systems: what matters is that a heavy leg week reads
// heavier than a light one, not that 1 unit of leg load "equals" 1 unit of
// aerobic load.
//
// Resolution order for a set: the explicit table below, else a rule derived
// from the catalogue's category, movement patterns and muscle groups, else a
// category-only fallback for a custom exercise that resolves to nothing. That
// last one attributes only what the category says (a custom conditioning drill
// is aerobic work; which muscles it hit is unknown) and leaves the rest
// unattributed rather than guessed.

import {
  type BodySystem,
  EXERCISE_DEFINITIONS,
  type ExerciseName,
  getExerciseHeatMapMuscles,
  getExerciseMovementPatterns,
  type HeatMapMuscle,
  type MovementPattern,
  normalizeExerciseName,
} from "@shared/schema";

import { round } from "./utils";

export type BodySystemProfile = Readonly<Record<BodySystem, number>>;

type ProfileValues = readonly [
  aerobic: number,
  runningImpact: number,
  legMuscle: number,
  upperPull: number,
];

function toProfile([
  aerobic,
  runningImpact,
  legMuscle,
  upperPull,
]: ProfileValues): BodySystemProfile {
  return {
    aerobic,
    running_impact: runningImpact,
    leg_muscle: legMuscle,
    upper_pull: upperPull,
  };
}

// A run is a full minute for the heart and lungs and a full minute of
// foot-strike. The legs carry about half: running is muscular work, but a
// minute of it is far less local leg fatigue than a minute of squatting.
const RUN: ProfileValues = [1, 1, 0.5, 0];

/**
 * Explicit profiles: every running, functional and conditioning exercise in the
 * catalogue, plus the strength movements the derived rule reads badly (the
 * Olympic lifts, thrusters and hanging core work). Values are
 * [aerobic, running impact, leg muscle, upper-body pull].
 */
const EXPLICIT_PROFILE_TABLE = {
  // Running. Pace and intensity are already in the session's RPE, so the
  // profile only changes where the mechanics do.
  run: RUN,
  run_1k: RUN,
  easy_run: RUN,
  recovery_run: RUN,
  tempo_run: RUN,
  fartlek_run: RUN,
  long_run: RUN,
  interval_run: [1, 1, 0.6, 0],
  hill_repeats: [1, 1, 0.8, 0],
  // The belt and the absence of terrain take some of the impact out.
  treadmill_run: [1, 0.85, 0.5, 0],

  // HYROX stations and functional work.
  skierg: [1, 0, 0.25, 0.8],
  rowing: [1, 0, 0.6, 0.5],
  sled_push: [0.6, 0, 1, 0],
  sled_pull: [0.6, 0, 0.5, 1],
  burpee_broad_jump: [0.9, 0.8, 0.8, 0],
  farmers_carry: [0.5, 0.3, 0.4, 0.6],
  sandbag_lunges: [0.6, 0.1, 1, 0],
  wall_balls: [0.7, 0.1, 0.8, 0],
  shuttle_run: [1, 1, 0.7, 0],
  med_ball_slams: [0.7, 0, 0.3, 0.3],
  step_ups: [0.4, 0.1, 1, 0],
  suitcase_carry: [0.4, 0.3, 0.3, 0.5],
  overhead_carry: [0.4, 0.3, 0.3, 0.1],
  front_rack_carry: [0.4, 0.3, 0.3, 0.3],
  yoke_carry: [0.5, 0.3, 0.7, 0.1],
  sandbag_carry: [0.5, 0.3, 0.5, 0.3],
  sandbag_clean: [0.6, 0, 0.8, 0.4],
  sandbag_to_shoulder: [0.6, 0, 0.8, 0.4],
  tire_flip: [0.6, 0, 0.9, 0.3],
  rope_climb: [0.4, 0, 0.2, 1],
  box_step_over: [0.5, 0.1, 1, 0],
  dumbbell_thruster: [0.6, 0, 0.7, 0],
  kettlebell_thruster: [0.6, 0, 0.7, 0],

  // Conditioning.
  burpees: [0.9, 0.4, 0.5, 0],
  box_jumps: [0.6, 0.8, 0.9, 0],
  devil_press: [0.9, 0, 0.6, 0.2],
  walking: [1, 0.3, 0.3, 0],
  incline_walk: [1, 0.3, 0.5, 0],
  hiking: [1, 0.4, 0.6, 0],
  rucking: [1, 0.5, 0.6, 0.1],
  cycling: [1, 0, 0.6, 0],
  bike_erg: [1, 0, 0.6, 0],
  stationary_bike: [1, 0, 0.6, 0],
  assault_bike: [1, 0, 0.5, 0.3],
  echo_bike: [1, 0, 0.5, 0.3],
  elliptical: [1, 0.1, 0.5, 0.1],
  stair_climber: [1, 0.2, 0.7, 0],
  swimming: [1, 0, 0.2, 0.7],
  sprints: [1, 1, 0.8, 0],
  treadmill_intervals: [1, 0.85, 0.6, 0],
  bear_crawl: [0.7, 0, 0.3, 0.1],
  crab_walk: [0.6, 0, 0.3, 0.1],
  jumping_jacks: [1, 0.5, 0.2, 0],
  high_knees: [1, 0.8, 0.4, 0],
  butt_kicks: [1, 0.8, 0.4, 0],
  jump_rope: [1, 0.8, 0.3, 0],
  mountain_climbers: [0.9, 0.1, 0.3, 0],
  kettlebell_swings: [0.7, 0, 0.7, 0.2],
  battle_ropes: [0.9, 0, 0.1, 0.3],
  walking_lunges: [0.5, 0.1, 1, 0],
  ski_erg_intervals: [1, 0, 0.25, 0.8],
  rowing_intervals: [1, 0, 0.6, 0.5],
  // Format placeholders: the work inside them is unknown, so only the aerobic
  // share is attributed.
  emom: [0.8, 0, 0, 0],
  amrap: [0.8, 0, 0, 0],

  // Strength the derived rule misreads.
  barbell_thruster: [0.4, 0, 0.7, 0],
  clean: [0.25, 0, 0.8, 0.3],
  power_clean: [0.25, 0, 0.8, 0.3],
  hang_clean: [0.25, 0, 0.8, 0.3],
  clean_and_jerk: [0.25, 0, 0.8, 0.3],
  snatch: [0.25, 0, 0.8, 0.3],
  power_snatch: [0.25, 0, 0.8, 0.3],
  hang_snatch: [0.25, 0, 0.8, 0.3],
  dumbbell_snatch: [0.4, 0, 0.6, 0.3],
  kettlebell_clean: [0.3, 0, 0.6, 0.3],
  kettlebell_snatch: [0.4, 0, 0.6, 0.3],
  // Hanging work loads grip and lats as well as the trunk.
  toes_to_bar: [0.3, 0, 0, 0.4],
  hanging_leg_raise: [0.15, 0, 0, 0.3],
} satisfies Partial<Record<ExerciseName, ProfileValues>>;

// Looked up by a runtime name, so read through a Map rather than by indexing
// the object — the same reason the catalogue categories below are.
const EXPLICIT_PROFILES: ReadonlyMap<string, ProfileValues> = new Map(
  Object.entries(EXPLICIT_PROFILE_TABLE),
);
const CATALOGUE_CATEGORIES: ReadonlyMap<string, string> = new Map(
  Object.entries(EXERCISE_DEFINITIONS).map(([name, definition]) => [name, definition.category]),
);

// What the derived rule reads from the catalogue. Hip flexors are left out of
// the legs so core work (leg raises, flutter kicks) does not count as leg load.
const LEG_MUSCLES: ReadonlySet<HeatMapMuscle> = new Set<HeatMapMuscle>([
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "hip_abductors",
  "tibialis",
]);
const PULLING_MUSCLES: ReadonlySet<HeatMapMuscle> = new Set<HeatMapMuscle>([
  "lats",
  "upper_back",
  "rear_delts",
  "biceps",
  "forearms",
  "traps",
]);
const LEG_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  "squat",
  "hinge",
  "lunge_split_squat",
]);
const PULL_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  "horizontal_pull",
  "vertical_pull",
]);

// Per category: the aerobic share, and how hard the category's muscular work
// is on the muscles it names. Lifting is felt mostly in the working muscles
// (hence the small aerobic share); conditioning the other way round.
interface CategoryWeights {
  aerobic: number;
  muscular: number;
}
const STRENGTH_WEIGHTS: CategoryWeights = { aerobic: 0.15, muscular: 1 };
const CATEGORY_WEIGHTS: ReadonlyMap<string, CategoryWeights> = new Map([
  ["strength", STRENGTH_WEIGHTS],
  ["functional", { aerobic: 0.6, muscular: 0.8 }],
  ["conditioning", { aerobic: 0.9, muscular: 0.6 }],
]);

// A pulling muscle worked without a pulling pattern (a curl, a shrug, a
// deadlift's grip and lats) counts at this fraction of a row or a pull-up.
const ISOLATED_PULL_SCALE = 0.6;

/**
 * What a custom exercise that resolves to nothing still tells us: its
 * category. Only the aerobic share is attributed — which muscles a custom
 * "Zottman curl" or "partner drill" hit is not something to guess.
 */
const CATEGORY_FALLBACK: ReadonlyMap<string, ProfileValues> = new Map<string, ProfileValues>([
  ["running", RUN],
  ["conditioning", [0.9, 0, 0, 0]],
  ["functional", [0.6, 0, 0, 0]],
  ["strength", [0.15, 0, 0, 0]],
]);

function share(muscles: readonly HeatMapMuscle[], group: ReadonlySet<HeatMapMuscle>): number {
  if (muscles.length === 0) return 0;
  return muscles.filter((m) => group.has(m)).length / muscles.length;
}

/**
 * The profile the catalogue implies, for an exercise with no explicit row.
 *
 * Legs: a squat, hinge or lunge pattern is full leg work; otherwise the share
 * of the exercise's muscles that are leg muscles (a calf raise is all legs, a
 * jerk two-thirds). Pull: a row or pull-down pattern is full pulling work;
 * otherwise a reduced share for pulling muscles worked in isolation.
 */
function deriveProfile(name: ExerciseName): BodySystemProfile {
  const category = CATALOGUE_CATEGORIES.get(name);
  if (category === "running") return toProfile(RUN);
  const weights = CATEGORY_WEIGHTS.get(category ?? "strength") ?? STRENGTH_WEIGHTS;
  const patterns = getExerciseMovementPatterns(name);
  const muscles = getExerciseHeatMapMuscles(name);
  const legs = patterns.some((p) => LEG_PATTERNS.has(p)) ? 1 : share(muscles, LEG_MUSCLES);
  const pull = patterns.some((p) => PULL_PATTERNS.has(p))
    ? 1
    : ISOLATED_PULL_SCALE * share(muscles, PULLING_MUSCLES);
  return toProfile([
    weights.aerobic,
    0,
    round(weights.muscular * legs, 2),
    round(weights.muscular * pull, 2),
  ]);
}

// Keyed on the canonical name: a closed set of ~210 keys, so no eviction.
const catalogueProfileCache = new Map<ExerciseName, BodySystemProfile>();

/** The profile of a catalogue exercise (explicit, else derived). */
export function catalogueBodySystemProfile(name: ExerciseName): BodySystemProfile {
  const cached = catalogueProfileCache.get(name);
  if (cached) return cached;
  const explicit = EXPLICIT_PROFILES.get(name);
  const profile = explicit ? toProfile(explicit) : deriveProfile(name);
  catalogueProfileCache.set(name, profile);
  return profile;
}

/**
 * The profile of one logged set, or null when nothing about it is known.
 *
 * A set named "custom" is resolved through its label first ("Bulgarian split
 * squats" is a catalogue exercise under an alias); a label that resolves to
 * nothing falls back to the set's category.
 */
export function bodySystemProfileForSet(set: {
  exerciseName: string;
  customLabel?: string | null;
  category?: string | null;
}): BodySystemProfile | null {
  const canonical = normalizeExerciseName(set.exerciseName);
  if (canonical && canonical !== "custom") return catalogueBodySystemProfile(canonical);
  const fromLabel = set.customLabel ? normalizeExerciseName(set.customLabel) : null;
  if (fromLabel && fromLabel !== "custom") return catalogueBodySystemProfile(fromLabel);
  const fallback = set.category ? CATEGORY_FALLBACK.get(set.category) : undefined;
  return fallback ? toProfile(fallback) : null;
}

// Endurance words in a session's own title, for a log with no sets (a
// free-text entry, or an import older than the sets device imports now carry).
// Word-bounded on purpose: "brunch" is not a run and "crow pose" is not a row.
// Ordered, first match wins: "stair stepper" before "walk", "ski erg" before
// "row" or "bike".
const TEXT_SPORT_EXERCISES: ReadonlyArray<readonly [RegExp, ExerciseName]> = [
  [/\bstair (?:stepper|climber)\b/, "stair_climber"],
  [/\bski ?erg\b/, "skierg"],
  [/\b(?:run|runs|running|jog|jogging)\b/, "run"],
  [/\b(?:row|rowing|rower)\b/, "rowing"],
  [/\b(?:ride|riding|bike|biking|cycle|cycling|spin)\b/, "cycling"],
  [/\b(?:swim|swimming)\b/, "swimming"],
  [/\b(?:hike|hiking)\b/, "hiking"],
  [/\b(?:walk|walking)\b/, "walking"],
  [/\belliptical\b/, "elliptical"],
];

/**
 * Split provider sport types and snake_case keys into words: "TrailRun" →
 * "trail run", "lap_swimming" → "lap swimming".
 */
function titleWords(text: string): string {
  return text
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ");
}

/**
 * The catalogue exercise a set-less session's title names, or null.
 *
 * The title and main text are tried whole first ("Easy run" is `easy_run`),
 * then for an endurance word. Only the focus and main text are read: notes
 * mention all sorts of things ("walked the dog after") that were not the
 * session. A title that names nothing leaves the session unattributed, which is
 * honest — "Hyrox class" or "WeightTraining" says an hour happened, not where.
 */
export function inferExerciseFromTitle(log: {
  focus: string;
  mainWorkout: string;
}): ExerciseName | null {
  for (const text of [log.focus, log.mainWorkout]) {
    const resolved = text ? normalizeExerciseName(text) : null;
    if (resolved && resolved !== "custom") return resolved;
  }
  const words = titleWords(`${log.focus} ${log.mainWorkout}`);
  for (const [pattern, exercise] of TEXT_SPORT_EXERCISES) {
    if (pattern.test(words)) return exercise;
  }
  return null;
}
