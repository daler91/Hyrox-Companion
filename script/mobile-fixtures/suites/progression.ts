/**
 * Session-to-session progression (shared/progression.ts), ported to
 * mobile/core/.../exercises/Progression.kt: the "Next" chip, which must equal
 * the target the workout engine writes into the plan.
 *
 * suggestNextTarget is covered at the boundaries its maths decides on, worked
 * out per implement and unit from loadIncrement: the reps-vs-weight crossover
 * (weight = step × (30 + reps)), the 10% gain cap (weight = 10 × step, half
 * that for the half step), and the deload floor. A seeded random sweep adds
 * mixed set counts, missing values and prescriptions.
 */
import { loadIncrement } from "@shared/exerciseEquipment";
import {
  epley,
  type ProgressionSet,
  suggestNextTarget,
  unmetPrescription,
} from "@shared/progression";

import { suite } from "../types";

interface Args {
  readonly category: string;
  readonly weightUnit: string;
  readonly previousSets?: readonly ProgressionSet[];
  readonly exerciseName?: string;
}

interface SuggestInput {
  readonly lastSets: readonly ProgressionSet[];
  readonly args: Args;
}

/** `count` identical sets. */
function sets(count: number, set: ProgressionSet): ProgressionSet[] {
  return Array.from({ length: count }, () => ({ ...set }));
}

/** Sets prescribed `plannedReps` @ `plannedWeight`, logged with the given reps. */
function prescribed(
  plannedReps: number,
  plannedWeight: number,
  reps: readonly number[],
  weight = plannedWeight,
): ProgressionSet[] {
  return reps.map((r) => ({ reps: r, weight, plannedReps, plannedWeight }));
}

const strength = (weightUnit: string, extra: Partial<Args> = {}): Args => ({
  category: "strength",
  weightUnit,
  ...extra,
});

/** One exercise per implement (and none, and an inherited Object.prototype name), each in both units. */
const EXERCISES: readonly (string | undefined)[] = [
  undefined,
  "back_squat",
  "pull_up",
  "dumbbell_bench_press",
  "kettlebell_swings",
  "leg_press",
  "constructor",
];
const UNITS = ["kg", "lb"] as const;

function withExercise(
  unit: string,
  exerciseName: string | undefined,
  extra: Partial<Args> = {},
): Args {
  return strength(unit, exerciseName === undefined ? extra : { ...extra, exerciseName });
}

/** The thresholds suggestNextTarget decides on, for each implement and unit. */
function boundaryCases(): SuggestInput[] {
  const cases: SuggestInput[] = [];
  for (const exerciseName of EXERCISES) {
    for (const unit of UNITS) {
      const step = loadIncrement(exerciseName ?? "", unit === "kg" ? "kg" : "lbs");
      const args = withExercise(unit, exerciseName);
      const progress: [number, number][] = [
        [5, step * 20], // light: +1 rep
        [5, step * 35], // the crossover itself: weight / 30 vs step × (1 + 5/30)
        [5, step * 40], // heavy: +one step
        [9, step * 39],
        [9, step * 39.5],
        [2, step * 3],
        [10, step * 10], // the standard step exactly at the 10% cap (audit L2)
        [10, step * 9.75], // standard step over the cap: the half step, if plate-loaded
        [10, step * 5], // the half step exactly at the cap
        [10, step * 4.9], // nothing fits
        [10, step * 60],
      ];
      for (const [reps, weight] of progress)
        cases.push({ lastSets: sets(2, { reps, weight }), args });

      // Missed twice at the same prescription: the deload floor, the half-step grid, and a repeat when both floor to zero.
      for (const planned of [step * 10, step * 10 + step / 3, step, step / 2, 100.3]) {
        const missed = prescribed(5, planned, [5, 4]);
        cases.push({
          lastSets: missed,
          args: withExercise(unit, exerciseName, { previousSets: missed }),
        });
      }
    }
  }
  return cases;
}

/** Deterministic pseudo-random numbers (a fixed LCG), so the fixture never changes on its own. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomCases(count: number): SuggestInput[] {
  const next = lcg(20261107);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const cases: SuggestInput[] = [];
  for (let i = 0; i < count; i++) {
    const setCount = 1 + Math.floor(next() * 5);
    const reps = 1 + Math.floor(next() * 11);
    const weight = Math.round(next() * 800) / 4;
    const mode = pick(["plain", "plain", "met", "missed", "vary"] as const);
    const lastSets: ProgressionSet[] = Array.from({ length: setCount }, (_, index) => {
      const lastSet = index === setCount - 1;
      if (mode === "plain") return { reps, weight };
      if (mode === "vary") return { reps: lastSet ? reps - 1 : reps, weight };
      const planned = { plannedReps: reps, plannedWeight: weight };
      if (mode === "met") return { reps: lastSet ? reps + 1 : reps, weight, ...planned };
      return { reps: lastSet ? Math.max(0, reps - 2) : reps, weight, ...planned };
    });
    const previousSets =
      mode === "missed" && next() < 0.5 ? lastSets.map((set) => ({ ...set })) : undefined;
    const exerciseName = pick(EXERCISES);
    const unit = pick(UNITS);
    cases.push({
      lastSets,
      args: withExercise(unit, exerciseName, previousSets ? { previousSets } : {}),
    });
  }
  return cases;
}

const back = { exerciseName: "back_squat" };

/** The named cases in docs/mobile-shared-logic.md, and the edges around them. */
const NAMED_CASES: SuggestInput[] = [
  // Progressing.
  { lastSets: sets(3, { reps: 5, weight: 100 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 8, weight: 20 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 10, weight: 20 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 10, weight: 25 }), args: strength("kg", back) },
  {
    lastSets: sets(3, { reps: 10, weight: 10 }),
    args: strength("kg", { exerciseName: "dumbbell_bench_press" }),
  },
  {
    lastSets: sets(3, { reps: 10, weight: 16 }),
    args: strength("kg", { exerciseName: "kettlebell_swings" }),
  },
  { lastSets: sets(3, { reps: 8, weight: 10 }), args: strength("kg", { exerciseName: "pull_up" }) },
  {
    lastSets: sets(3, { reps: 10, weight: 10 }),
    args: strength("kg", { exerciseName: "pull_up" }),
  },
  {
    lastSets: sets(3, { reps: 10, weight: 20 }),
    args: strength("kg", { exerciseName: "constructor" }),
  },
  {
    lastSets: sets(3, { reps: 10, weight: 20 }),
    args: strength("kg", { exerciseName: "toString" }),
  },
  {
    lastSets: sets(3, { reps: 10, weight: 20 }),
    args: strength("kg", { exerciseName: "__proto__" }),
  },
  // Units: anything but "kg" is pounds.
  { lastSets: sets(3, { reps: 5, weight: 225 }), args: strength("lbs", back) },
  { lastSets: sets(3, { reps: 5, weight: 225 }), args: strength("lb", back) },
  { lastSets: sets(3, { reps: 5, weight: 225 }), args: strength("KG", back) },
  { lastSets: sets(3, { reps: 5, weight: 225 }), args: strength("", back) },
  // Exercise name: a label is not a key, so barbell; omitted and "" are barbell too.
  {
    lastSets: sets(3, { reps: 10, weight: 20 }),
    args: strength("kg", { exerciseName: "Back Squat" }),
  },
  { lastSets: sets(3, { reps: 10, weight: 20 }), args: strength("kg") },
  { lastSets: sets(3, { reps: 10, weight: 20 }), args: strength("kg", { exerciseName: "" }) },
  {
    lastSets: sets(3, { reps: 10, weight: 20 }),
    args: strength("kg", { exerciseName: "goblet_squat" }),
  },
  {
    lastSets: sets(3, { reps: 10, weight: 20 }),
    args: strength("kg", { exerciseName: "walking_lunges" }),
  },
  // Silent: not strength, no footing for Epley.
  { lastSets: sets(3, { reps: 5, weight: 100 }), args: { category: "running", weightUnit: "kg" } },
  { lastSets: sets(3, { reps: 5, weight: 100 }), args: { category: "Strength", weightUnit: "kg" } },
  { lastSets: sets(3, { reps: 5, weight: 100 }), args: { category: "", weightUnit: "kg" } },
  { lastSets: prescribed(5, 100, [5, 5, 4]), args: { category: "functional", weightUnit: "kg" } },
  { lastSets: sets(3, { reps: 5, weight: 0 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 5, weight: -20 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 1, weight: 100 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 0, weight: 100 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 11, weight: 100 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 2, weight: 100 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 10, weight: 100 }), args: strength("kg", back) },
  {
    lastSets: [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 100 },
      { reps: 4, weight: 100 },
    ],
    args: strength("kg", back),
  },
  {
    lastSets: [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 102.5 },
    ],
    args: strength("kg", back),
  },
  { lastSets: [], args: strength("kg", back) },
  { lastSets: [{ reps: 5, weight: 100 }], args: strength("kg", back) },
  // Missing values: undefined and null both mean "not logged".
  { lastSets: [{ reps: 5 }, { reps: 5 }], args: strength("kg", back) },
  { lastSets: [{ weight: 100 }, { weight: 100 }], args: strength("kg", back) },
  {
    lastSets: [
      { reps: null, weight: 100 },
      { reps: 5, weight: 100 },
    ],
    args: strength("kg", back),
  },
  {
    lastSets: [
      { reps: 5, weight: 100 },
      { reps: 5, weight: null },
    ],
    args: strength("kg", back),
  },
  {
    lastSets: [{ reps: 5, weight: 100, plannedReps: null, plannedWeight: null }],
    args: strength("kg", back),
  },
  // Rounding: the weight branch rounds to 2 dp with Math.round; the reps branch keeps the weight as logged.
  { lastSets: sets(3, { reps: 5, weight: 100.333 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 5, weight: 33.3333 }), args: strength("kg", back) },
  { lastSets: sets(3, { reps: 3, weight: 1.005 * 100 }), args: strength("kg", back) },
  {
    lastSets: sets(2, { reps: 8, weight: 72.125 }),
    args: strength("lb", { exerciseName: "dumbbell_bench_press" }),
  },
  // Missed prescriptions.
  { lastSets: prescribed(5, 100, [5, 5, 4]), args: strength("kg", back) },
  {
    lastSets: prescribed(5, 100, [5, 5, 4]),
    args: strength("kg", { ...back, previousSets: prescribed(5, 100, [5, 4, 4]) }),
  },
  {
    lastSets: prescribed(5, 100, [5, 5, 4]),
    args: strength("kg", { ...back, previousSets: prescribed(5, 97.5, [5, 5, 4]) }),
  },
  {
    lastSets: prescribed(5, 100, [5, 5, 4]),
    args: strength("kg", { ...back, previousSets: prescribed(4, 100, [4, 4, 3]) }),
  },
  {
    lastSets: prescribed(5, 100, [5, 5, 4]),
    args: strength("kg", { ...back, previousSets: prescribed(5, 100, [5, 5, 5]) }),
  },
  { lastSets: prescribed(5, 100, [5, 5, 4]), args: strength("kg", { ...back, previousSets: [] }) },
  {
    lastSets: prescribed(5, 100, [5, 5, 5], 95),
    args: strength("kg", { ...back, previousSets: prescribed(5, 100, [5, 5, 5], 95) }),
  },
  {
    lastSets: prescribed(8, 20, [8, 8, 6]),
    args: strength("kg", {
      exerciseName: "kettlebell_swings",
      previousSets: prescribed(8, 20, [8, 7, 6]),
    }),
  },
  {
    lastSets: prescribed(10, 1, [10, 9]),
    args: strength("kg", {
      exerciseName: "dumbbell_bench_press",
      previousSets: prescribed(10, 1, [10, 9]),
    }),
  },
  {
    lastSets: prescribed(10, 1, [10, 9]),
    args: strength("kg", { exerciseName: "back_squat", previousSets: prescribed(10, 1, [10, 9]) }),
  },
  {
    lastSets: prescribed(10, 0.5, [10, 9]),
    args: strength("kg", {
      exerciseName: "back_squat",
      previousSets: prescribed(10, 0.5, [10, 9]),
    }),
  },
  {
    lastSets: prescribed(5, 102.3, [5, 3]),
    args: strength("kg", { ...back, previousSets: prescribed(5, 102.3, [4, 3]) }),
  },
  { lastSets: prescribed(5, 1.005, [5, 4]), args: strength("kg", back) },
  { lastSets: prescribed(5, 2.675, [5, 4]), args: strength("kg", back) },
  { lastSets: prescribed(5, 100, [5, 5, 5], 97.5), args: strength("kg", back) },
  { lastSets: [{ plannedReps: 5, plannedWeight: 100 }], args: strength("kg", back) },
  { lastSets: prescribed(5, 0, [4, 4]), args: strength("kg", back) },
  { lastSets: prescribed(3, 100, [3, 3, 3], 100), args: strength("kg", back) },
  // A prescription that varies set to set falls through to the uniform check.
  {
    lastSets: [
      { reps: 5, weight: 100, plannedReps: 5, plannedWeight: 100 },
      { reps: 5, weight: 100, plannedReps: 6, plannedWeight: 100 },
    ],
    args: strength("kg", back),
  },
  {
    lastSets: [
      { reps: 4, weight: 100, plannedReps: 5, plannedWeight: 100 },
      { reps: 4, weight: 100, plannedReps: 5, plannedWeight: 102.5 },
    ],
    args: strength("kg", back),
  },
  {
    lastSets: [
      { reps: 4, weight: 100, plannedReps: 5, plannedWeight: 100 },
      { reps: 4, weight: 100 },
    ],
    args: strength("kg", back),
  },
];

/** unmetPrescription on its own: nothing prescribed, met, missed on reps or weight, varying, non-positive. */
const UNMET_CASES: ProgressionSet[][] = [
  [],
  sets(2, { reps: 5, weight: 100 }),
  prescribed(5, 100, [5, 5]),
  [
    { reps: 5, weight: 100, plannedReps: 5, plannedWeight: 100 },
    { reps: 6, weight: 102.5, plannedReps: 5, plannedWeight: 100 },
  ],
  prescribed(5, 100, [3]),
  prescribed(5, 100, [5], 90),
  [{ plannedReps: 5, plannedWeight: 100 }],
  [{ reps: null, weight: null, plannedReps: 5, plannedWeight: 100 }],
  [
    { reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 },
    { reps: 3, weight: 100, plannedReps: 6, plannedWeight: 100 },
  ],
  [
    { reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 },
    { reps: 3, weight: 100 },
  ],
  [
    { reps: 3, weight: 100 },
    { reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 },
  ],
  [{ reps: 3, weight: 100, plannedReps: 5 }],
  [{ reps: 3, weight: 100, plannedWeight: 100 }],
  [{ reps: 3, weight: 100, plannedReps: null, plannedWeight: 100 }],
  prescribed(5, 0, [3]),
  prescribed(5, -10, [3]),
  prescribed(0, 100, [0], 90),
  prescribed(0, 100, [0]),
  prescribed(5, 100, [5, 5, 4]),
  prescribed(5, 100.005, [5, 4]),
];

const EPLEY_CASES: [number, number][] = [
  [100, 5],
  [0, 10],
  [100, 0],
  [100, 1],
  [100, 10],
  [102.5, 3],
  [60, 8],
  [20, 7],
  [33.3, 9],
  [225, 5],
  [1.005, 2],
  [-20, 5],
  [100, -3],
  [100, 30],
  [0.1, 0.2],
  [1e6, 12],
];

export const progressionSuites = [
  suite({
    name: "progression.suggestNextTarget",
    description:
      "suggestNextTarget: the named cases, the crossover, cap and deload boundaries per implement and unit, and a seeded random sweep.",
    run: ({ lastSets, args }: SuggestInput) =>
      suggestNextTarget(lastSets, args as Parameters<typeof suggestNextTarget>[1]),
    cases: [...NAMED_CASES, ...boundaryCases(), ...randomCases(60)],
  }),
  suite({
    name: "progression.unmetPrescription",
    description:
      "unmetPrescription: the prescription when every set carried the same one and a set fell short of it.",
    run: (input: ProgressionSet[]) => unmetPrescription(input),
    cases: UNMET_CASES,
  }),
  suite({
    name: "progression.epley",
    description: "epley: weight × (1 + reps / 30).",
    run: ([weight, reps]: [number, number]) => epley(weight, reps),
    cases: EPLEY_CASES,
  }),
];
