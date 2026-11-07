/**
 * lintWorkoutStructure (shared/schema/structureLint.ts), ported to
 * mobile/core/.../structure/StructureLint.kt. The server answers a workout
 * save whose lint has schemaErrors with a 400, so the app must find the same
 * issues before it queues one.
 *
 * Each case is `{ case, blocks?, exercises? }`; `case` only names it. An
 * absent key and null are both passed through, as the server would get them.
 * Values the Zod schemas would refuse (upper-case enums, a stepNumber of 0)
 * are marked with `off(...)`: the linter does not validate, so its behaviour
 * on them is pinned too.
 */
import { lintWorkoutStructure } from "../../../shared/schema/structureLint";
import type { ParsedExercise, StructureBlockInput } from "../../../shared/schema/types";
import { suite } from "../types";

type Block = StructureBlockInput;
type Step = Block["steps"][number];
type Exercise = ParsedExercise;
type ExerciseSet = Exercise["sets"][number];

interface LintCase {
  readonly case: string;
  readonly blocks?: Block[] | null;
  readonly exercises?: Exercise[] | null;
}

/** A value outside the declared type, passed on purpose. */
function off<T>(value: unknown): T {
  return value as T;
}

function step(overrides: Partial<Step> = {}): Step {
  return { stepNumber: 1, stepType: "work", ...overrides };
}

function block(overrides: Partial<Block> = {}): Block {
  return { sectionType: "main", formatType: "steady", steps: [], ...overrides };
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return { exerciseName: "Wall Balls", category: "conditioning", sets: [], ...overrides };
}

function set(overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return { setNumber: 1, ...overrides };
}

/** An exercise whose only set links to `blockId` step `stepNumber`. */
function linkedTo(blockId: string, ...stepNumbers: number[]): Exercise {
  return exercise({ sets: stepNumbers.map((stepNumber, i) => set({ setNumber: i + 1, blockId, stepNumber })) });
}

/** Steps 1..count, all untargeted: one MISSING_STEP_TARGET each in a for_time block. */
function untargetedSteps(count: number): Step[] {
  return Array.from({ length: count }, (_, i) => step({ stepNumber: i + 1 }));
}

/** A capped for_time block whose `count` steps have no target: exactly `count` infos. */
function forTimeInfos(count: number): Block {
  return block({ formatType: "for_time", durationSeconds: 600, steps: untargetedSteps(count) });
}

/** An AMRAP block with an id and no steps or cap: exactly one error, with or without exercises. */
function amrapMissingCap(id = "amrap-1"): Block {
  return block({ id, formatType: "amrap" });
}

/** An exercise that yields exactly one AMBIGUOUS_REPS_SCOPE warning. */
function ambiguousReps(exerciseName = "Bulgarian Split Squat"): Exercise {
  return exercise({ exerciseName, repMode: "per_side", reps: 20, sets: [set({ reps: 10 })] });
}

/** A linkable EMOM block: id "block-1", 10 minutes, one work step. */
function emom(overrides: Partial<Block> = {}): Block {
  return block({
    id: "block-1",
    formatType: "emom",
    durationMinutes: 10,
    steps: [step({ stepNumber: 1, minuteIndex: 1 })],
    ...overrides,
  });
}

/** An exercise with a set but no link: turns the link checks on without satisfying any. */
const unlinkedRow = exercise({ sets: [set()] });

const emptyCases: LintCase[] = [
  { case: "no arguments" },
  { case: "null blocks and exercises", blocks: null, exercises: null },
  { case: "empty arrays", blocks: [], exercises: [] },
  { case: "null blocks, empty exercises", blocks: null, exercises: [] },
  { case: "empty blocks, null exercises", blocks: [], exercises: null },
  { case: "clean steady block and exercise", blocks: [block()], exercises: [exercise()] },
  { case: "clean block with a work step", blocks: [block({ steps: [step()] })] },
  { case: "clean exercise only", exercises: [exercise({ reps: 10, sets: [set({ reps: 10 })] })] },
  {
    case: "only the required fields",
    blocks: [{ sectionType: "warmup", formatType: "steady", steps: [off<Step>({ stepNumber: 1 })] }],
    exercises: [off<Exercise>({ exerciseName: "Burpees", category: "conditioning" })],
  },
  {
    case: "several clean blocks and exercises",
    blocks: [
      block({ formatType: "amrap", id: "a", timeCapMinutes: 12 }),
      block({ formatType: "rounds", id: "r", roundCount: 4 }),
      block({ formatType: "interval", workSeconds: 40, restSeconds: 20 }),
      block({ formatType: "for_time", timeCapMinutes: 15, steps: [step({ targets: { distance: 1000 } })] }),
      block({ formatType: "quality" }),
    ],
    exercises: [exercise({ exerciseName: "SkiErg" }), exercise({ exerciseName: "Rowing", repMode: "total", reps: 1 })],
  },
];

const ambiguousRepsCases: LintCase[] = [
  {
    case: "per_side with top-level and set reps",
    exercises: [exercise({ exerciseName: "Bulgarian Split Squat", repMode: "per_side", reps: 20, sets: [set({ reps: 10 })] })],
  },
  { case: "repMode total", exercises: [exercise({ repMode: "total", reps: 20, sets: [set({ reps: 10 })] })] },
  { case: "repMode absent", exercises: [exercise({ reps: 20, sets: [set({ reps: 10 })] })] },
  { case: "repMode null", exercises: [exercise({ repMode: off(null), reps: 20, sets: [set({ reps: 10 })] })] },
  { case: "repMode PER_SIDE (exact match only)", exercises: [exercise({ repMode: off("PER_SIDE"), reps: 20, sets: [set({ reps: 10 })] })] },
  { case: "top-level reps absent", exercises: [exercise({ repMode: "per_side", sets: [set({ reps: 10 })] })] },
  { case: "top-level reps null", exercises: [exercise({ repMode: "per_side", reps: off(null), sets: [set({ reps: 10 })] })] },
  { case: "no set has reps", exercises: [exercise({ repMode: "per_side", reps: 20, sets: [set()] })] },
  { case: "set reps null", exercises: [exercise({ repMode: "per_side", reps: 20, sets: [set({ reps: off(null) })] })] },
  { case: "sets empty", exercises: [exercise({ repMode: "per_side", reps: 20, sets: [] })] },
  { case: "sets absent", exercises: [exercise({ repMode: "per_side", reps: 20, sets: off(undefined) })] },
  { case: "sets null", exercises: [exercise({ repMode: "per_side", reps: 20, sets: off(null) })] },
  { case: "top-level reps 0 is present", exercises: [exercise({ repMode: "per_side", reps: 0, sets: [set({ reps: 10 })] })] },
  { case: "set reps 0 is present", exercises: [exercise({ repMode: "per_side", reps: 20, sets: [set({ reps: 0 })] })] },
  {
    case: "only a later set has reps",
    exercises: [exercise({ repMode: "per_side", reps: 20, sets: [set(), set({ setNumber: 2 }), set({ setNumber: 3, reps: 8 })] })],
  },
  { case: "two offending exercises", exercises: [ambiguousReps("Lunges"), ambiguousReps("Step Ups")] },
  {
    case: "offending exercise between clean ones",
    exercises: [exercise(), ambiguousReps("Single-Arm Row"), exercise({ repMode: "per_side", sets: [set({ reps: 6 })] })],
  },
  { case: "custom exercise name", exercises: [ambiguousReps("custom")] },
  { case: "non-ASCII exercise name", exercises: [ambiguousReps("Überzug – 1½ ✓")] },
  { case: "empty exercise name", exercises: [ambiguousReps("")] },
];

const amrapCases: LintCase[] = [
  { case: "AMRAP with rounds and a cap", blocks: [block({ formatType: "amrap", rounds: 3, timeCapMinutes: 12 })] },
  { case: "AMRAP with no cap", blocks: [block({ formatType: "amrap" })] },
  { case: "AMRAP capped by timeCapMinutes", blocks: [block({ formatType: "amrap", timeCapMinutes: 12 })] },
  { case: "AMRAP capped by durationMinutes", blocks: [block({ formatType: "amrap", durationMinutes: 12 })] },
  { case: "AMRAP capped by durationSeconds", blocks: [block({ formatType: "amrap", durationSeconds: 720 })] },
  { case: "AMRAP durationSeconds 0 is present", blocks: [block({ formatType: "amrap", durationSeconds: 0 })] },
  { case: "AMRAP timeCapMinutes 0 is present", blocks: [block({ formatType: "amrap", timeCapMinutes: off(0) })] },
  {
    case: "AMRAP caps all null",
    blocks: [block({ formatType: "amrap", durationSeconds: null, durationMinutes: null, timeCapMinutes: null })],
  },
  { case: "AMRAP with rounds and no cap", blocks: [block({ formatType: "amrap", rounds: 3 })] },
  { case: "AMRAP rounds 0 is present", blocks: [block({ formatType: "amrap", rounds: off(0), timeCapMinutes: 10 })] },
  { case: "AMRAP rounds null", blocks: [block({ formatType: "amrap", rounds: null, timeCapMinutes: 10 })] },
  { case: "AMRAP roundCount is not checked", blocks: [block({ formatType: "amrap", roundCount: 5, timeCapMinutes: 10 })] },
  { case: "AMRAP upper case, no cap", blocks: [block({ formatType: off("AMRAP") })] },
  {
    case: "AMRAP upper case, no id, with exercises: no link check",
    blocks: [block({ formatType: off("AMRAP"), steps: [step()] })],
    exercises: [unlinkedRow],
  },
  { case: "Amrap mixed case with rounds", blocks: [block({ formatType: off("Amrap"), rounds: 2 })] },
];

const roundsCases: LintCase[] = [
  { case: "rounds with no count", blocks: [block({ formatType: "rounds" })] },
  { case: "rounds with roundCount", blocks: [block({ formatType: "rounds", roundCount: 5 })] },
  { case: "rounds with legacy rounds", blocks: [block({ formatType: "rounds", rounds: 5 })] },
  { case: "rounds roundCount 0 is present", blocks: [block({ formatType: "rounds", roundCount: off(0) })] },
  { case: "rounds counts both null", blocks: [block({ formatType: "rounds", roundCount: null, rounds: null })] },
  { case: "ROUNDS upper case with no count", blocks: [block({ formatType: off("ROUNDS") })] },
  { case: "rounds with only a duration", blocks: [block({ formatType: "rounds", durationMinutes: 20, timeCapMinutes: 20 })] },
];

const forTimeCases: LintCase[] = [
  { case: "for_time with no cap", blocks: [block({ formatType: "for_time" })] },
  { case: "for_time with only durationMinutes", blocks: [block({ formatType: "for_time", durationMinutes: 10 })] },
  { case: "for_time with durationSeconds", blocks: [block({ formatType: "for_time", durationSeconds: 600 })] },
  { case: "for_time with timeCapMinutes", blocks: [block({ formatType: "for_time", timeCapMinutes: 10 })] },
  { case: "for_time durationSeconds 0 is present", blocks: [block({ formatType: "for_time", durationSeconds: 0 })] },
  { case: "for_time caps null", blocks: [block({ formatType: "for_time", durationSeconds: null, timeCapMinutes: null })] },
  {
    case: "for_time with no cap and an untargeted step",
    blocks: [block({ formatType: "for_time", steps: [step({ stepNumber: 3 })] })],
  },
  {
    case: "FOR_TIME upper case, capped, untargeted step",
    blocks: [block({ formatType: off("FOR_TIME"), timeCapMinutes: 10, steps: [step()] })],
  },
  { case: "step with targets absent", blocks: [forTimeInfos(1)] },
  {
    case: "step with targets null",
    blocks: [block({ formatType: "for_time", durationSeconds: 600, steps: [step({ targets: null })] })],
  },
  {
    case: "step with empty targets",
    blocks: [block({ formatType: "for_time", durationSeconds: 600, steps: [step({ targets: {} })] })],
  },
  ...(
    [
      ["reps", { reps: 12 }],
      ["targetReps", { targetReps: 12 }],
      ["distance", { distance: 100 }],
      ["targetDistance", { targetDistance: 100 }],
      ["time", { time: 0.75 }],
      ["targetTime", { targetTime: 45 }],
      ["reps 0 (present)", { reps: 0 }],
      ["targetTime 0 (present)", { targetTime: 0 }],
      ["reps null, targetReps set", { reps: null, targetReps: 5 }],
      ["distance and weight", { distance: 50, weight: 20 }],
      ["weight only (not counted)", { weight: 50 }],
      ["targetWeight only (not counted)", { targetWeight: 50 }],
      ["every target null", { reps: null, targetReps: null, time: null, targetTime: null, distance: null, targetDistance: null }],
    ] as const
  ).map(([label, targets]): LintCase => ({
    case: `for_time step target: ${label}`,
    blocks: [block({ formatType: "for_time", durationSeconds: 600, steps: [step({ targets })] })],
  })),
  {
    case: "for_time rest step with no target still gets an info",
    blocks: [
      block({
        formatType: "for_time",
        timeCapMinutes: 20,
        steps: [step({ stepNumber: 1, targets: { distance: 1000 } }), step({ stepNumber: 2, stepType: "rest" })],
      }),
    ],
  },
  {
    case: "for_time: steps 1 and 2 untargeted, 3 targeted",
    blocks: [
      block({
        formatType: "for_time",
        durationSeconds: 900,
        steps: [step({ stepNumber: 1 }), step({ stepNumber: 2 }), step({ stepNumber: 3, targets: { reps: 30 } })],
      }),
    ],
  },
  ...[7, 10_000, 0, -1, 9_007_199_254_740_991].map(
    (stepNumber): LintCase => ({
      case: `for_time info message for step ${stepNumber}`,
      blocks: [block({ formatType: "for_time", durationSeconds: 600, steps: [step({ stepNumber })] })],
    }),
  ),
  { case: "for_time step with no stepType", blocks: [block({ formatType: "for_time", timeCapMinutes: 5, steps: [off<Step>({ stepNumber: 4 })] })] },
];

const intervalCases: LintCase[] = [
  { case: "interval with no work or rest", blocks: [block({ formatType: "interval" })] },
  { case: "interval workSeconds and restSeconds", blocks: [block({ formatType: "interval", workSeconds: 40, restSeconds: 20 })] },
  { case: "interval alias pair", blocks: [block({ formatType: "interval", workIntervalSec: 40, restIntervalSec: 20 })] },
  { case: "interval zeros are present", blocks: [block({ formatType: "interval", workSeconds: 0, restSeconds: 0 })] },
  { case: "interval alias zeros are present", blocks: [block({ formatType: "interval", workIntervalSec: 0, restIntervalSec: 0 })] },
  { case: "interval only workSeconds", blocks: [block({ formatType: "interval", workSeconds: 40 })] },
  { case: "interval only restSeconds", blocks: [block({ formatType: "interval", restSeconds: 20 })] },
  { case: "interval only workIntervalSec", blocks: [block({ formatType: "interval", workIntervalSec: 40 })] },
  { case: "interval workSeconds with restIntervalSec", blocks: [block({ formatType: "interval", workSeconds: 40, restIntervalSec: 20 })] },
  { case: "interval workIntervalSec with restSeconds", blocks: [block({ formatType: "interval", workIntervalSec: 40, restSeconds: 20 })] },
  {
    case: "interval primary pair complete, alias half",
    blocks: [block({ formatType: "interval", workSeconds: 40, restSeconds: 20, workIntervalSec: 30 })],
  },
  {
    case: "interval alias pair complete, primary half",
    blocks: [block({ formatType: "interval", workSeconds: 40, workIntervalSec: 30, restIntervalSec: 30 })],
  },
  {
    case: "interval all null",
    blocks: [block({ formatType: "interval", workSeconds: null, restSeconds: null, workIntervalSec: null, restIntervalSec: null })],
  },
  { case: "INTERVAL upper case with no work or rest", blocks: [block({ formatType: off("INTERVAL") })] },
  {
    case: "interval complete, restSeconds and a rest step",
    blocks: [block({ formatType: "interval", workSeconds: 40, restSeconds: 20, steps: [step(), step({ stepNumber: 2, stepType: "rest" })] })],
  },
];

const unconstrainedFormatCases: LintCase[] = [
  ...["steady", "quality", "emom"].map(
    (formatType): LintCase => ({ case: `bare ${formatType} block`, blocks: [block({ formatType: off(formatType) })] }),
  ),
  { case: "unknown format", blocks: [block({ formatType: off("tabata"), steps: [step()] })], exercises: [unlinkedRow] },
  { case: "empty format", blocks: [block({ formatType: off("") })] },
];

const restScopeCases: LintCase[] = [
  { case: "restSeconds and a rest stepType", blocks: [block({ restSeconds: 60, steps: [step({ stepType: "rest" })] })] },
  { case: "restSeconds and a rest stepRole", blocks: [block({ restSeconds: 60, steps: [step({ stepRole: "rest" })] })] },
  { case: "restSeconds and stepRole Rest", blocks: [block({ restSeconds: 60, steps: [step({ stepRole: "Rest" })] })] },
  { case: "restSeconds and stepType REST", blocks: [block({ restSeconds: 60, steps: [step({ stepType: off("REST") })] })] },
  { case: "rest step, restSeconds absent", blocks: [block({ steps: [step({ stepType: "rest" })] })] },
  { case: "rest step, restSeconds null", blocks: [block({ restSeconds: null, steps: [step({ stepType: "rest" })] })] },
  { case: "restSeconds, work step only", blocks: [block({ restSeconds: 60, steps: [step()] })] },
  { case: "restSeconds, transition step", blocks: [block({ restSeconds: 60, steps: [step({ stepType: "transition" })] })] },
  { case: "restSeconds, no steps", blocks: [block({ restSeconds: 60 })] },
  { case: "restSeconds 0 is present", blocks: [block({ restSeconds: 0, steps: [step({ stepType: "rest" })] })] },
  {
    case: "stepRole work hides stepType rest",
    blocks: [block({ restSeconds: 60, steps: [step({ stepRole: "work", stepType: "rest" })] })],
  },
  {
    case: "stepRole rest beats stepType work",
    blocks: [block({ restSeconds: 60, steps: [step({ stepRole: "rest", stepType: "work" })] })],
  },
  {
    case: "empty stepRole hides stepType rest",
    blocks: [block({ restSeconds: 60, steps: [step({ stepRole: "", stepType: "rest" })] })],
  },
  {
    case: "null stepRole falls through to stepType rest",
    blocks: [block({ restSeconds: 60, steps: [step({ stepRole: null, stepType: "rest" })] })],
  },
  {
    case: "two rest steps, one warning",
    blocks: [block({ restSeconds: 60, steps: [step({ stepType: "rest" }), step({ stepNumber: 2 }), step({ stepNumber: 3, stepType: "rest" })] })],
  },
  {
    case: "two conflicting blocks",
    blocks: [
      block({ restSeconds: 30, steps: [step({ stepType: "rest" })] }),
      block({ sectionType: "cooldown", restSeconds: 90, steps: [step({ stepRole: "REST" })] }),
    ],
  },
  { case: "workSeconds and a rest step is fine", blocks: [block({ workSeconds: 60, steps: [step({ stepType: "rest" })] })] },
];

const linkCases: LintCase[] = [
  { case: "id-less EMOM, no exercises", blocks: [emom({ id: undefined })] },
  { case: "id-less EMOM, empty exercises", blocks: [emom({ id: undefined })], exercises: [] },
  { case: "id-less EMOM, null exercises", blocks: [emom({ id: undefined })], exercises: null },
  { case: "id-less EMOM with an exercise", blocks: [emom({ id: undefined })], exercises: [unlinkedRow] },
  { case: "EMOM with an empty id", blocks: [emom({ id: "" })], exercises: [unlinkedRow] },
  { case: "id-less EMOM with no steps", blocks: [emom({ id: undefined, steps: [] })], exercises: [unlinkedRow] },
  {
    case: "id-less AMRAP with an exercise",
    blocks: [block({ formatType: "amrap", timeCapMinutes: 12, steps: [step()] })],
    exercises: [unlinkedRow],
  },
  {
    case: "id-less rounds with an exercise",
    blocks: [block({ formatType: "rounds", roundCount: 3, steps: [step()] })],
    exercises: [unlinkedRow],
  },
  {
    case: "unlinked work step in rounds",
    blocks: [emom({ formatType: "rounds", roundCount: 3, steps: [step({ stepNumber: 1 })] })],
    exercises: [exercise({ sets: [set({ distance: 50 })] })],
  },
  { case: "linked EMOM step", blocks: [emom()], exercises: [linkedTo("block-1", 1)] },
  ...(
    [
      ["rest stepType", step({ minuteIndex: 1, stepType: "rest" })],
      ["rest stepRole", step({ minuteIndex: 1, stepRole: "rest" })],
      ["transition stepType", step({ minuteIndex: 1, stepType: "transition" })],
      ["free-text stepRole", step({ minuteIndex: 1, stepRole: "cooldown" })],
      ["empty stepRole over work stepType", step({ minuteIndex: 1, stepRole: "" })],
    ] as const
  ).map(([label, s]): LintCase => ({ case: `no link needed: ${label}`, blocks: [emom({ steps: [s] })], exercises: [unlinkedRow] })),
  ...(
    [
      ["no stepType or stepRole", off<Step>({ stepNumber: 1, minuteIndex: 1 })],
      ["null stepType and stepRole", step({ minuteIndex: 1, stepType: off(null), stepRole: null })],
      ["stepType WORK", step({ minuteIndex: 1, stepType: off("WORK") })],
      ["stepRole Work", step({ minuteIndex: 1, stepRole: "Work", stepType: "rest" })],
    ] as const
  ).map(([label, s]): LintCase => ({ case: `link needed: ${label}`, blocks: [emom({ steps: [s] })], exercises: [unlinkedRow] })),
  ...(
    [
      ["mismatched stepNumber", set({ blockId: "block-1", stepNumber: 2 })],
      ["mismatched blockId", set({ blockId: "other-block", stepNumber: 1 })],
      ["blockId differing in case", set({ blockId: "Block-1", stepNumber: 1 })],
      ["null stepNumber", set({ blockId: "block-1", stepNumber: off(null) })],
      ["absent blockId", set({ stepNumber: 1 })],
      ["null blockId", set({ blockId: off(null), stepNumber: 1 })],
      ["empty blockId", set({ blockId: "", stepNumber: 1 })],
    ] as const
  ).map(([label, s]): LintCase => ({ case: `not linked: ${label}`, blocks: [emom()], exercises: [exercise({ sets: [s] })] })),
  {
    case: "stepNumber 0 links (non-null)",
    blocks: [emom({ steps: [step({ stepNumber: 0, minuteIndex: 1 })] })],
    exercises: [linkedTo("block-1", 0)],
  },
  {
    case: "EMOM: step 1 linked, 2 unlinked, 3 rest",
    blocks: [
      emom({
        steps: [
          step({ stepNumber: 1, minuteIndex: 1 }),
          step({ stepNumber: 2, minuteIndex: 2 }),
          step({ stepNumber: 3, minuteIndex: 3, stepType: "rest" }),
        ],
      }),
    ],
    exercises: [linkedTo("block-1", 1)],
  },
  {
    case: "links from different exercises",
    blocks: [emom({ steps: [step({ stepNumber: 1, minuteIndex: 1 }), step({ stepNumber: 2, minuteIndex: 2 })] })],
    exercises: [linkedTo("block-1", 2), exercise({ exerciseName: "Burpees" }), linkedTo("block-1", 1)],
  },
  {
    case: "one exercise links two steps",
    blocks: [emom({ steps: [step({ stepNumber: 1, minuteIndex: 1 }), step({ stepNumber: 2, minuteIndex: 2 })] })],
    exercises: [linkedTo("block-1", 1, 2)],
  },
  { case: "exercise with sets absent", blocks: [emom()], exercises: [exercise({ sets: off(undefined) })] },
  { case: "exercise with sets null", blocks: [emom()], exercises: [exercise({ sets: off(null) })] },
  { case: "exercise with no sets", blocks: [emom()], exercises: [exercise()] },
  {
    case: "a top-level link on the exercise does not count",
    blocks: [emom()],
    exercises: [exercise({ blockId: "block-1", stepNumber: 1, sets: [set()] })],
  },
  ...["for_time", "interval", "steady", "quality"].map(
    (formatType): LintCase => ({
      case: `no link check for ${formatType}`,
      blocks: [
        block({
          id: "b",
          formatType: off(formatType),
          durationSeconds: 600,
          timeCapMinutes: 10,
          workSeconds: 40,
          restSeconds: 20,
          steps: [step({ targets: { reps: 10 } })],
        }),
      ],
      exercises: [unlinkedRow],
    }),
  ),
  { case: "EMOM upper case, no id: no link check", blocks: [emom({ id: undefined, formatType: off("EMOM") })], exercises: [unlinkedRow] },
  {
    case: "id-less EMOM then an unlinked rounds step",
    blocks: [emom({ id: undefined }), block({ id: "r-2", formatType: "rounds", roundCount: 2, steps: [step({ stepNumber: 4 })] })],
    exercises: [unlinkedRow],
  },
  {
    case: "block id with a colon",
    blocks: [emom({ id: "a:1", steps: [step({ stepNumber: 2, minuteIndex: 1 }), step({ stepNumber: 12, minuteIndex: 2 })] })],
    exercises: [linkedTo("a:1", 2), linkedTo("a", 12)],
  },
  { case: "link message for step 10000", blocks: [emom({ steps: [step({ stepNumber: 10_000, minuteIndex: 1 })] })], exercises: [unlinkedRow] },
  {
    case: "linked EMOM, AMRAP and rounds",
    blocks: [
      emom(),
      block({ id: "amrap-2", formatType: "amrap", timeCapMinutes: 8, steps: [step(), step({ stepNumber: 2 })] }),
      block({ id: "rounds-3", formatType: "rounds", roundCount: 3, steps: [step({ stepRole: "rest" }), step({ stepNumber: 2 })] }),
    ],
    exercises: [linkedTo("block-1", 1), linkedTo("amrap-2", 1, 2), linkedTo("rounds-3", 2)],
  },
];

const scoreCases: LintCase[] = [
  { case: "score: one info", blocks: [forTimeInfos(1)] },
  { case: "score: one warning", exercises: [ambiguousReps()] },
  { case: "score: one error", blocks: [amrapMissingCap()] },
  { case: "score: error, warning and info", blocks: [amrapMissingCap(), forTimeInfos(1)], exercises: [ambiguousReps()] },
  { case: "score: 3 errors, 3 infos (1)", blocks: [amrapMissingCap(), amrapMissingCap(), amrapMissingCap(), forTimeInfos(3)] },
  { case: "score: 3 errors, 1 warning (0)", blocks: [amrapMissingCap(), amrapMissingCap(), amrapMissingCap()], exercises: [ambiguousReps()] },
  {
    case: "score: 3 errors, 1 warning, 1 info (clamped)",
    blocks: [amrapMissingCap(), amrapMissingCap(), amrapMissingCap(), forTimeInfos(1)],
    exercises: [ambiguousReps()],
  },
  { case: "score: 4 errors (clamped)", blocks: [amrapMissingCap(), amrapMissingCap(), amrapMissingCap(), amrapMissingCap()] },
  { case: "score: 33 infos (1)", blocks: [forTimeInfos(33)] },
  { case: "score: 34 infos (clamped)", blocks: [forTimeInfos(34)] },
  { case: "score: 9 warnings (10)", exercises: Array.from({ length: 9 }, (_, i) => ambiguousReps(`Exercise ${i + 1}`)) },
  { case: "score: 10 warnings (0)", exercises: Array.from({ length: 10 }, (_, i) => ambiguousReps(`Exercise ${i + 1}`)) },
  { case: "score: 2 errors, 4 warnings (0)", blocks: [amrapMissingCap(), amrapMissingCap()], exercises: Array.from({ length: 4 }, () => ambiguousReps()) },
  { case: "score: 2 errors, 3 warnings, 3 infos (1)", blocks: [amrapMissingCap(), amrapMissingCap(), forTimeInfos(3)], exercises: Array.from({ length: 3 }, () => ambiguousReps()) },
  { case: "score: 2 errors, 2 warnings, 7 infos (clamped at 101)", blocks: [amrapMissingCap(), amrapMissingCap(), forTimeInfos(7)], exercises: [ambiguousReps(), ambiguousReps()] },
];

const combinedCases: LintCase[] = [
  {
    case: "every rule at once, in order",
    blocks: [
      block({ formatType: "amrap", rounds: 4, steps: [step()] }),
      block({
        id: "ft",
        formatType: "for_time",
        restSeconds: 30,
        steps: [step({ stepNumber: 1 }), step({ stepNumber: 2, stepType: "rest" }), step({ stepNumber: 3, targets: { time: 2 } })],
      }),
      block({ formatType: "interval", workSeconds: 30 }),
      block({ formatType: "rounds", id: "r", steps: [step({ stepNumber: 1 }), step({ stepNumber: 2 })] }),
      emom({ steps: [step({ stepNumber: 1, minuteIndex: 1 }), step({ stepNumber: 2, minuteIndex: 2 })] }),
    ],
    exercises: [ambiguousReps("Lunges"), linkedTo("r", 2), linkedTo("block-1", 1), ambiguousReps("Pistol Squat")],
  },
  {
    case: "block issues group by block, link issues last",
    blocks: [
      block({ id: "e1", formatType: "emom", restSeconds: 15, steps: [step({ stepNumber: 1 }), step({ stepNumber: 2, stepRole: "rest" })] }),
      block({ formatType: "for_time", steps: [step({ stepNumber: 5 })] }),
      block({ formatType: "amrap", rounds: 2, durationMinutes: 10, restSeconds: 10, steps: [step({ stepType: "rest" })] }),
    ],
    exercises: [exercise({ repMode: "per_side", reps: 12, sets: [set({ reps: 6, blockId: "e1", stepNumber: 2 })] })],
  },
  {
    case: "AMRAP with rounds, no cap, no id, unlinked",
    blocks: [block({ formatType: "amrap", rounds: 5, steps: [step()] })],
    exercises: [unlinkedRow],
  },
  {
    case: "for_time with no cap, a rest conflict and untargeted steps",
    blocks: [block({ formatType: "for_time", restSeconds: 60, steps: [step({ stepNumber: 1 }), step({ stepNumber: 2, stepRole: "rest" })] })],
  },
  {
    case: "valid web save: linked EMOM and a targeted for_time",
    blocks: [
      emom({ id: "emom-a", steps: [step({ stepNumber: 1, minuteIndex: 1 }), step({ stepNumber: 2, minuteIndex: 2 })] }),
      block({ id: "ft-b", formatType: "for_time", timeCapMinutes: 12, steps: [step({ targets: { targetDistance: 1000 } })] }),
    ],
    exercises: [linkedTo("emom-a", 1), linkedTo("emom-a", 2), exercise({ exerciseName: "Running", sets: [set({ distance: 1000, blockId: "ft-b", stepNumber: 1 })] })],
  },
];

export const structureLintSuites = [
  suite({
    name: "structureLint.lintWorkoutStructure",
    description:
      "lintWorkoutStructure: every rule alone and combined, null and absent fields, presence checks at 0, messages with step numbers, and the score clamp.",
    run: ({ blocks, exercises }: LintCase) => lintWorkoutStructure(blocks, exercises),
    cases: [
      ...emptyCases,
      ...ambiguousRepsCases,
      ...amrapCases,
      ...roundsCases,
      ...forTimeCases,
      ...intervalCases,
      ...unconstrainedFormatCases,
      ...restScopeCases,
      ...linkCases,
      ...scoreCases,
      ...combinedCases,
    ],
  }),
];
