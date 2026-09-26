/**
 * What the athlete's own words say about exercise choice: the goal they wrote
 * (read as a lens — HYROX, running, strength, hybrid, body composition, or
 * general) and the constraints they declared (equipment they lack, movements
 * they can't do, body regions to protect).
 *
 * Split from exerciseSelection.ts, which turns this reading plus their logged
 * history into the brief. Deliberately conservative: everything here only
 * decides what the brief may NOMINATE; the athlete's words themselves still
 * reach the model, which decides anything this reading misses.
 */
import { type Equipment, EXERCISE_EQUIPMENT } from "@shared/exerciseEquipment";
import { HYROX_STATION_ORDER } from "@shared/raceConstants";
import type { ExerciseName } from "@shared/schema/exercises";

import {
  EQUIPMENT_NEGATION_PATTERNS,
  type ExperienceLevel,
  type GoalLens,
  HIGH_SKILL_EXERCISES,
  LENS_GOAL_PATTERNS,
  limitedBefore,
  ONLY_EQUIPMENT_KEYWORDS,
  ONLY_EQUIPMENT_PATTERNS,
  STRESS_REGION_EXERCISES,
  STRESS_REGION_PATTERNS,
  type StressRegion,
} from "./exerciseKnowledge";

export const ALL_EQUIPMENT: readonly Equipment[] = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "pullup_bar",
  "sled",
  "rower",
  "skierg",
  "bike",
  "med_ball",
  "sandbag",
  "box",
];

export const STATION_KEYS: ReadonlySet<string> = new Set<string>(HYROX_STATION_ORDER);

// ---------------------------------------------------------------------------
// Goal lens
// ---------------------------------------------------------------------------

function lensFromFocusAreas(focusAreas: readonly string[] | null | undefined): GoalLens {
  const focus = new Set(focusAreas ?? []);
  if ([...focus].some((area) => STATION_KEYS.has(area))) return "hyrox";
  if (focus.has("running") && focus.has("strength")) return "hybrid";
  if (focus.has("running")) return "running";
  if (focus.has("strength")) return "strength";
  return "general";
}

/**
 * Classify the goal the athlete wrote. HYROX wins outright (it contains
 * running and strength by definition); running plus strength is the hybrid
 * lens; weight loss only when nothing more specific is named, since "get
 * stronger and lean out" is a strength programme. A vague goal falls back to
 * the wizard's focus areas.
 */
export function classifyGoalLens(
  goal?: string | null,
  focusAreas?: readonly string[] | null,
): GoalLens {
  const text = goal?.trim() ?? "";
  if (!text) return lensFromFocusAreas(focusAreas);
  if (matchesAny(LENS_GOAL_PATTERNS.hyrox, text)) return "hyrox";
  const running = matchesAny(LENS_GOAL_PATTERNS.running, text);
  const strength = matchesAny(LENS_GOAL_PATTERNS.strength, text);
  if (running && strength) return "hybrid";
  if (running) return "running";
  if (strength) return "strength";
  if (matchesAny(LENS_GOAL_PATTERNS.weight_loss, text)) return "weight_loss";
  return lensFromFocusAreas(focusAreas);
}

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Constraint profile
// ---------------------------------------------------------------------------

// A limiting word on either side of the movement, within ~24 characters of
// the same clause: "can't do lunges", "lunges hurt my knee".
const LIMIT_BEFORE =
  /\b(?:no|without|avoid|avoiding|can'?t|can'?t do|cannot|cannot do|unable to do|not allowed)\b[^.;\n]{0,24}$/i;
const LIMIT_AFTER =
  /^[^.;\n]{0,24}?\b(?:hurts?|hurting|pain|painful|aggravates?|irritates?|flares?)\b/i;

/** Whether some match of `noun` (a global pattern) has a limiting word beside it. */
function limitedMovement(text: string, noun: RegExp): boolean {
  if (limitedBefore(text, noun, [LIMIT_BEFORE])) return true;
  for (const match of text.matchAll(noun)) {
    if (LIMIT_AFTER.test(text.slice(match.index + match[0].length))) return true;
  }
  return false;
}

/**
 * Movements the athlete says they can't do, as opposed to equipment they
 * don't have. Needs a limiting word on either side ("no burpees", "lunges
 * hurt my knee") — unlike the keyword match stationCoverage uses to silence a
 * station-gap nag, these REMOVE candidates, so a passing mention ("I love
 * lunges") must not count.
 */
const MOVEMENT_LIMIT_PATTERNS: readonly (readonly [RegExp, readonly ExerciseName[]])[] = [
  [/\blunges?\b/gi, ["sandbag_lunges", "walking_lunges", "lunges", "reverse_lunge"]],
  [/\bburpees?\b/gi, ["burpee_broad_jump", "burpees"]],
  [
    /\b(?:jump|jumps|jumping|plyo|plyos|plyometric|plyometrics)\b/gi,
    ["box_jumps", "burpee_broad_jump", "burpees", "jump_rope"],
  ],
];

export interface ConstraintProfile {
  readonly unavailable: ReadonlySet<Equipment>;
  readonly excluded: ReadonlySet<string>;
  readonly regions: ReadonlySet<StressRegion>;
}

const EMPTY_PROFILE: ConstraintProfile = {
  unavailable: new Set(),
  excluded: new Set(),
  regions: new Set(),
};

function unavailableEquipment(text: string): Set<Equipment> {
  const unavailable = new Set<Equipment>();
  for (const [noun, equipment] of EQUIPMENT_NEGATION_PATTERNS) {
    if (limitedBefore(text, noun)) unavailable.add(equipment);
  }
  if (!matchesAny(ONLY_EQUIPMENT_PATTERNS, text)) return unavailable;
  // "Just dumbbells and a pull-up bar": everything not named is out.
  const kept = new Set(
    ONLY_EQUIPMENT_KEYWORDS.filter(([pattern]) => pattern.test(text)).map(
      ([, equipment]) => equipment,
    ),
  );
  for (const equipment of ALL_EQUIPMENT) {
    if (!kept.has(equipment)) unavailable.add(equipment);
  }
  return unavailable;
}

/** What the athlete's own constraint text rules out of the candidate lists. */
export function parseConstraintProfile(text?: string | null): ConstraintProfile {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return EMPTY_PROFILE;

  const excluded = new Set<string>();
  for (const [noun, exercises] of MOVEMENT_LIMIT_PATTERNS) {
    if (!limitedMovement(trimmed, noun)) continue;
    for (const exercise of exercises) excluded.add(exercise);
  }

  const regions = new Set<StressRegion>();
  for (const [pattern, region] of STRESS_REGION_PATTERNS) {
    if (pattern.test(trimmed)) regions.add(region);
  }

  return { unavailable: unavailableEquipment(trimmed), excluded, regions };
}

/**
 * Whether the brief may nominate an exercise. A lift the athlete already does
 * skips the skill filter — they have shown they can perform it — but never the
 * constraint filters, which describe their situation today.
 */
export function isExerciseAllowed(
  exercise: string,
  profile: ConstraintProfile,
  experience: ExperienceLevel,
  familiar: boolean,
): boolean {
  if (profile.excluded.has(exercise)) return false;
  const equipment = EXERCISE_EQUIPMENT[exercise as ExerciseName];
  if (equipment?.every((item) => profile.unavailable.has(item))) return false;
  for (const region of profile.regions) {
    if (STRESS_REGION_EXERCISES.get(region)?.has(exercise)) return false;
  }
  return familiar || experience !== "beginner" || !HIGH_SKILL_EXERCISES.has(exercise);
}
