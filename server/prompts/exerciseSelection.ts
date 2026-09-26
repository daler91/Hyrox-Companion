import { HYROX_STATION_ORDER } from "@shared/raceConstants";
import type { ExerciseName } from "@shared/schema/exercises";

import {
  LENS_SUMMARIES,
  PATTERN_GROUP_LABELS,
  PATTERN_GROUPS,
  type PatternGroup,
  PRIMARY_SLOT_LABELS,
  STRESS_REGION_LABELS,
} from "../services/ai/exerciseKnowledge";
import {
  type ExerciseSelectionBrief,
  type PrimaryLift,
  type SelectionCandidate,
  selectionExerciseLabel,
  type UpcomingPatternShape,
} from "../services/ai/exerciseSelection";
import { sanitizeUserInput } from "../utils/sanitize";

/**
 * Renders the exercise-selection brief (server/services/ai/exerciseSelection.ts)
 * as the prompt block every coaching surface shares: auto-coach suggestions and
 * review notes, chat, chat plan edits, and each plan-generation chunk. One
 * renderer so they never drift — the reason formatCoachingAnalysis is shared.
 *
 * Two audiences, because the two outputs name exercises differently. The
 * coach writes prose the athlete reads (a rationale that says
 * "seated_cable_row" is a bug), so it gets display names. Plan generation
 * writes `exerciseName` keys into JSON, so it gets the exact keys the EXERCISE
 * KEYS menu uses.
 */
export type ExerciseBriefAudience = "coach" | "plan";

const HEADER =
  "--- EXERCISE SELECTION BRIEF (computed from this athlete's own logs and profile — choose exercises from it first) ---";
const FOOTER = "--- END EXERCISE SELECTION BRIEF ---";

function exerciseName(exercise: string, audience: ExerciseBriefAudience): string {
  if (exercise.startsWith("custom:")) {
    // Athlete-authored: their own name for an exercise, so it is sanitized
    // like every other free-text field that reaches a prompt.
    const label = sanitizeUserInput(exercise.slice("custom:".length));
    return audience === "plan" ? `custom "${label}"` : label;
  }
  return audience === "plan" ? exercise : selectionExerciseLabel(exercise);
}

function candidateText(candidate: SelectionCandidate, audience: ExerciseBriefAudience): string {
  const name = exerciseName(candidate.exercise, audience);
  return candidate.sessions > 0 ? `${name} (logged ${candidate.sessions}x)` : name;
}

/** "a", "a and b", "a, b and c". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function daysAgo(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return " (today)";
  return days === 1 ? " (yesterday)" : ` (${days} days ago)`;
}

function stapleLines(brief: ExerciseSelectionBrief, audience: ExerciseBriefAudience): string[] {
  if (brief.staples.length === 0) {
    return [
      "FAMILIAR EXERCISES: none logged in the last 10 weeks — start from simple, low-skill variations and build load gradually.",
    ];
  }
  return [
    "FAMILIAR EXERCISES (logged in the last 10 weeks — keep and progress these rather than swapping them for look-alikes):",
    ...brief.staples.map((staple) => {
      const last = staple.lastSession ? `, last ${staple.lastSession}` : "";
      return `- ${exerciseName(staple.exercise, audience)}: ${staple.sessions} sessions${last}${daysAgo(staple.daysSince)}`;
    }),
  ];
}

function needLines(brief: ExerciseSelectionBrief, audience: ExerciseBriefAudience): string[] {
  if (brief.needs.length === 0) {
    return [
      brief.staples.length === 0
        ? "NEEDS: not enough logged history to find weak links yet — build complete, balanced weeks for this goal and let the logs show what is missing."
        : "NEEDS: nothing stands out — recent training already covers this goal's patterns. Progress what is there; do not swap exercises for novelty.",
    ];
  }
  return [
    'NEEDS (most important first; every candidate already fits this athlete\'s goal, equipment, constraints and experience, and "logged Nx" marks ones they know):',
    ...brief.needs.map((need, index) => {
      const candidates = need.candidates
        .map((candidate) => candidateText(candidate, audience))
        .join(", ");
      const method = need.method ? `; ${need.method}` : "";
      return `${index + 1}. ${need.reason} → ${candidates}${method}`;
    }),
  ];
}

function substitutionLines(
  brief: ExerciseSelectionBrief,
  audience: ExerciseBriefAudience,
): string[] {
  if (brief.stationSubstitutions.length === 0) return [];
  const entries = brief.stationSubstitutions.map(
    (substitution) =>
      `${exerciseName(substitution.station, audience)} → ${substitution.substitutes
        .map((candidate) => candidateText(candidate, audience))
        .join(", ")}`,
  );
  return [
    `STATIONS THE CONSTRAINTS RULE OUT — train the same demand with these instead: ${entries.join("; ")}`,
  ];
}

function constraintLines(brief: ExerciseSelectionBrief): string[] {
  const parts: string[] = [];
  if (brief.limitedRegions.length > 0) {
    parts.push(
      `limits ${joinList(brief.limitedRegions.map((region) => STRESS_REGION_LABELS.get(region) ?? region))}`,
    );
  }
  if (brief.unavailableEquipment.length > 0) {
    parts.push(
      `no ${brief.unavailableEquipment.map((item) => item.replaceAll("_", "-")).join(", ")}`,
    );
  }
  if (parts.length === 0) return [];
  return [
    `CONSTRAINT FILTER: the athlete's constraints read as ${parts.join("; ")}. Every candidate above already respects this; their own words (ATHLETE CONSTRAINTS) decide anything this reading misses.`,
  ];
}

function groupLabel(group: PatternGroup): string {
  return PATTERN_GROUP_LABELS.get(group) ?? group;
}

function shapeLine(shape: UpcomingPatternShape): string {
  const counts = PATTERN_GROUPS.map(
    (group) => `${groupLabel(group)} ${shape.setsByGroup.get(group) ?? 0}`,
  ).join(" · ");
  const parts = [
    `UPCOMING WEEK SHAPE (${shape.structuredDays} of ${shape.totalDays} upcoming days have exercise tables) — planned sets by pattern: ${counts}.`,
  ];
  if (shape.missing.length > 0) {
    const pronoun = shape.missing.length === 1 ? "it" : "them";
    parts.push(
      `This goal also needs ${joinList(shape.missing.map(groupLabel))} work, which the coming week never touches — cover ${pronoun} by swapping a redundant exercise, never by adding a session, and not at all in TAPER or RACE WEEK.`,
    );
  }
  if (shape.backToBackLowerBody.length > 0) {
    const pairs = shape.backToBackLowerBody
      .map(([first, second]) => `${first} and ${second}`)
      .join("; ");
    parts.push(
      `Heavy squat/hinge work lands on back-to-back days (${pairs}) — lighten or re-pattern one of each pair.`,
    );
  }
  return parts.join(" ");
}

export function formatExerciseSelectionBrief(
  brief: ExerciseSelectionBrief | undefined,
  audience: ExerciseBriefAudience,
): string {
  if (!brief) return "";
  const lines = [
    HEADER,
    `GOAL LENS: ${LENS_SUMMARIES[brief.lens]}`,
    ...stapleLines(brief, audience),
    ...needLines(brief, audience),
    ...substitutionLines(brief, audience),
    ...constraintLines(brief),
  ];
  if (brief.raceStandards) {
    lines.push(
      `RACE STANDARDS (${brief.raceStandards}) — set station loads relative to these (e.g. 70-80% of race load for volume, 100-110% for strength-biased sled work) rather than guessing.`,
    );
  }
  if (audience === "coach" && brief.upcomingShape) lines.push(shapeLine(brief.upcomingShape));
  lines.push(FOOTER);
  return lines.join("\n");
}

/** "squat: back_squat (athlete's own, 9 sessions) · hinge: romanian_deadlift". */
export function formatPrimaryLifts(lifts: readonly PrimaryLift[]): string {
  return lifts
    .map((lift) => {
      const own = lift.sessions > 0 ? ` (athlete's own, ${lift.sessions} sessions)` : "";
      return `${PRIMARY_SLOT_LABELS[lift.slot]}: ${lift.exercise}${own}`;
    })
    .join(" · ");
}

/**
 * The exercise keys the plan generator may use, grouped by what they train.
 *
 * Replaces a flat list of ~50 keys in four categories, which told the model
 * what exists but nothing about what each is FOR — so it reached for the same
 * handful every time. Grouping by movement pattern puts the choice a coach
 * actually makes ("which hinge?") in front of it, and widens the vocabulary
 * to exercises the catalogue already knew but the prompt never mentioned
 * (trap bar deadlift, chest-supported row, calf and tibialis work), so they
 * land as tracked keys instead of free-text custom rows.
 */
const EXERCISE_MENU_GROUPS: readonly (readonly [string, readonly ExerciseName[]])[] = [
  ["HYROX stations", HYROX_STATION_ORDER],
  [
    "Running",
    [
      "run_1k",
      "easy_run",
      "recovery_run",
      "tempo_run",
      "interval_run",
      "hill_repeats",
      "fartlek_run",
      "long_run",
      "treadmill_run",
    ],
  ],
  [
    "Squat (knee-dominant)",
    [
      "back_squat",
      "front_squat",
      "goblet_squat",
      "box_squat",
      "leg_press",
      "hack_squat",
      "belt_squat",
    ],
  ],
  [
    "Hinge (posterior chain)",
    [
      "deadlift",
      "romanian_deadlift",
      "trap_bar_deadlift",
      "hip_thrust",
      "glute_bridge",
      "kettlebell_swings",
      "good_morning",
      "back_extension",
      "nordic_hamstring_curl",
      "hamstring_curl",
    ],
  ],
  [
    "Single-leg",
    [
      "bulgarian_split_squat",
      "walking_lunges",
      "lunges",
      "reverse_lunge",
      "split_squat",
      "step_ups",
      "box_step_over",
      "single_leg_rdl",
    ],
  ],
  [
    "Horizontal push",
    [
      "bench_press",
      "incline_bench_press",
      "dumbbell_bench_press",
      "incline_dumbbell_bench_press",
      "push_up",
      "dip",
    ],
  ],
  ["Vertical push", ["overhead_press", "push_press", "seated_dumbbell_press", "landmine_press"]],
  ["Vertical pull", ["pull_up", "chin_up", "lat_pulldown", "straight_arm_pulldown"]],
  [
    "Horizontal pull",
    [
      "bent_over_row",
      "seated_cable_row",
      "single_arm_dumbbell_row",
      "chest_supported_row",
      "inverted_row",
      "face_pull",
    ],
  ],
  ["Carries and grip", ["suitcase_carry", "front_rack_carry", "sandbag_carry", "overhead_carry"]],
  [
    "Trunk",
    [
      "plank",
      "side_plank",
      "pallof_press",
      "dead_bug",
      "hanging_leg_raise",
      "ab_wheel_rollout",
      "russian_twist",
    ],
  ],
  [
    "Power and full-body",
    [
      "barbell_thruster",
      "dumbbell_thruster",
      "dumbbell_snatch",
      "kettlebell_clean",
      "power_clean",
      "med_ball_slams",
      "devil_press",
    ],
  ],
  [
    "Conditioning",
    [
      "burpees",
      "box_jumps",
      "shuttle_run",
      "battle_ropes",
      "sprints",
      "jump_rope",
      "mountain_climbers",
    ],
  ],
  [
    "Engines",
    [
      "ski_erg_intervals",
      "rowing_intervals",
      "assault_bike",
      "echo_bike",
      "bike_erg",
      "stair_climber",
    ],
  ],
  [
    "Durability (lower leg and hips)",
    [
      "standing_calf_raise",
      "seated_calf_raise",
      "tibialis_raise",
      "clamshell",
      "hip_abduction_machine",
    ],
  ],
];

export function buildExerciseMenu(): string {
  return [
    "EXERCISE KEYS (use these exact keys for exerciseName; grouped by what they train):",
    ...EXERCISE_MENU_GROUPS.map(([label, exercises]) => `- ${label}: ${exercises.join(", ")}`),
    '- Anything else: exerciseName "custom" with a clear customLabel (e.g. "Turkish Get-Up").',
  ].join("\n");
}

/** Every key the menu offers, for tests and callers that validate against it. */
export const EXERCISE_MENU_KEYS: readonly ExerciseName[] = EXERCISE_MENU_GROUPS.flatMap(
  ([, exercises]) => exercises,
);
