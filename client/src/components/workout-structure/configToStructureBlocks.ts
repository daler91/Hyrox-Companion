import type { StructureBlockInput } from "@shared/schema";

import type { BlockType, WorkoutStep,WorkoutStructureConfig } from "./types";

type StructureStep = StructureBlockInput["steps"][number];

interface ConfigToBlockOptions {
  readonly sequenceOrder?: number;
  readonly sortOrder?: number;
  readonly fallbackExerciseName?: string;
}

// The targets a rest step may not carry (structureStepSchema), and that stop
// describing a step once it is no longer a movement.
const PERFORMANCE_TARGET_KEYS: ReadonlySet<string> = new Set([
  "targetReps",
  "targetTime",
  "targetDistance",
  "targetWeight",
  "reps",
  "time",
  "distance",
  "weight",
]);

function stepTargetsForConfig(step: WorkoutStep): NonNullable<StructureBlockInput["steps"][number]["targets"]> | undefined {
  const targets: Record<string, unknown> = {};
  if (step.target) targets.instructions = step.target;
  if (typeof step.durationSeconds === "number" && Number.isFinite(step.durationSeconds)) {
    targets.durationSeconds = step.durationSeconds;
  }
  return Object.keys(targets).length > 0
    ? (targets)
    : undefined;
}

function durationSecondsFromTargets(targets: StructureBlockInput["steps"][number]["targets"]): number | undefined {
  if (!targets || typeof targets !== "object") return undefined;
  const raw = (targets as Record<string, unknown>).durationSeconds;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function configStepToStructureStep(
  step: WorkoutStep,
  stepIdx: number,
  blockType: BlockType,
  fallbackExerciseName?: string,
): StructureStep {
  return {
    stepNumber: stepIdx + 1,
    stepType: step.type,
    exerciseName: step.type === "work" ? (step.exercise ?? fallbackExerciseName) : undefined,
    minuteIndex: blockType === "emom" ? stepIdx + 1 : undefined,
    targets: stepTargetsForConfig(step),
  };
}

export function configToStructureBlock(
  config: WorkoutStructureConfig,
  options: ConfigToBlockOptions = {},
): StructureBlockInput {
  const { sequenceOrder, sortOrder, fallbackExerciseName } = options;
  const steps = config.steps.map((step, stepIdx) =>
    configStepToStructureStep(step, stepIdx, config.blockType, fallbackExerciseName),
  );
  return {
    ...(config.id ? { id: config.id } : {}),
    sectionType: config.section,
    formatType: config.blockType,
    durationMinutes:
      config.blockType === "emom" ? config.emomDurationMinutes ?? steps.length : undefined,
    timeCapMinutes: config.blockType === "amrap" ? config.timeCapMinutes ?? 10 : undefined,
    roundCount: config.blockType === "rounds" ? config.roundCount ?? 3 : undefined,
    score: config.score ?? undefined,
    sequenceOrder,
    sortOrder,
    steps,
  };
}

/**
 * The editor's view of a stored block. `stepIds` names the steps by position;
 * passing the ids a previous load gave them keeps the step rows mounted across
 * a server echo or a rollback, where fresh ids remounted every row and took the
 * focused input with it (U3, CODEBASE_ANALYSIS_2026-10-03).
 */
export function structureBlockToConfig(
  block: StructureBlockInput,
  stepIds: readonly string[] = [],
): WorkoutStructureConfig {
  const fallbackSection: WorkoutStructureConfig["section"] =
    block.sectionType === "activation" ? "warmup" : block.sectionType;
  const blockType: WorkoutStructureConfig["blockType"] =
    block.formatType === "quality" ? "steady" : block.formatType;
  const steps: WorkoutStep[] = block.steps.map((step, stepIdx) => ({
    id: stepIds.at(stepIdx) ?? crypto.randomUUID(),
    type: step.stepType ?? "work",
    exercise: step.exerciseName ?? undefined,
    target: typeof step.targets?.instructions === "string" ? step.targets.instructions : undefined,
    durationSeconds: durationSecondsFromTargets(step.targets),
  }));
  return {
    id: block.id,
    section: fallbackSection,
    blockType,
    emomDurationMinutes:
      block.formatType === "emom" ? block.durationMinutes ?? undefined : undefined,
    timeCapMinutes: block.formatType === "amrap" ? block.timeCapMinutes ?? block.durationMinutes ?? undefined : undefined,
    roundCount: block.formatType === "rounds" ? block.roundCount ?? block.rounds ?? undefined : undefined,
    steps,
    score: block.score ?? null,
  };
}

function targetsOrNull(entries: [string, unknown][]): StructureStep["targets"] {
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function withDurationSeconds(
  targets: StructureStep["targets"],
  durationSeconds: number | undefined,
): StructureStep["targets"] {
  const kept = Object.entries(targets ?? {}).filter(([key]) => key !== "durationSeconds");
  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
    kept.push(["durationSeconds", durationSeconds]);
  }
  return targetsOrNull(kept);
}

function retypeStep(step: StructureStep, view: WorkoutStep): StructureStep {
  if (view.type === "work") {
    return { ...step, stepType: "work", exerciseName: view.exercise ?? step.exerciseName };
  }
  // A rest or transition is not a movement: the exercise and its performance
  // targets described the step it replaced, and a rest step may not carry them.
  return {
    ...step,
    stepType: view.type,
    exerciseName: null,
    customLabel: null,
    category: null,
    stepRole: null,
    targets: targetsOrNull(
      Object.entries(step.targets ?? {}).filter(([key]) => !PERFORMANCE_TARGET_KEYS.has(key)),
    ),
  };
}

/**
 * An EMOM step keeps the minute it was stored with unless it moved: renumbering
 * every step of an edited block from 1 erased a stored pattern on non-contiguous
 * minutes (say 2, 4, 6) on any edit to that block. A step that moved, or never
 * had a minute, is left without one here for placeEmomMinutes to place.
 * CL14 (CODEBASE_ANALYSIS_2026-10-03)
 */
function keptMinute(base: StructureStep, stepNumber: number, blockType: BlockType): StructureStep["minuteIndex"] {
  if (blockType !== "emom") return base.minuteIndex;
  return base.stepNumber === stepNumber ? base.minuteIndex : null;
}

/**
 * A minute for a step placed after `after` and before `before` (the next kept
 * step's minute) that no other step holds: the minute stored for the slot it
 * moved into, else the first free one after the previous step's. Null when
 * there is no room between its neighbours.
 */
function freeMinute(
  after: number,
  before: number,
  slot: StructureStep["minuteIndex"],
  taken: ReadonlySet<number>,
): number | null {
  if (slot != null && slot > after && slot < before && !taken.has(slot)) return slot;
  let minute = after + 1;
  while (taken.has(minute)) minute += 1;
  return minute < before ? minute : null;
}

/**
 * Give each EMOM step left without a minute (added, moved, or never had one) a
 * minute in step order that no kept step holds, so a kept step never loses its
 * own and an appended step never runs before the last one. Only when no such
 * minute exists, which a stored pattern out of minute order can cause, is every
 * step numbered by position: the server rejects two steps on one minute.
 * CL14 (CODEBASE_ANALYSIS_2026-10-03)
 */
function placeEmomMinutes(steps: readonly StructureStep[], slots: readonly StructureStep[]): StructureStep[] {
  const taken = new Set<number>();
  steps.forEach((step) => {
    if (step.minuteIndex != null) taken.add(step.minuteIndex);
  });
  const placed: StructureStep[] = [];
  let previous = 0;
  for (const [idx, step] of steps.entries()) {
    const nextKept = steps.slice(idx + 1).find((later) => later.minuteIndex != null)?.minuteIndex;
    const minute =
      step.minuteIndex ?? freeMinute(previous, nextKept ?? Number.POSITIVE_INFINITY, slots.at(idx)?.minuteIndex, taken);
    if (minute === null) return steps.map((byPosition) => ({ ...byPosition, minuteIndex: byPosition.stepNumber }));
    taken.add(minute);
    previous = minute;
    placed.push({ ...step, minuteIndex: minute });
  }
  return placed;
}

function mergeStep(
  base: StructureStep | undefined,
  baseView: WorkoutStep | undefined,
  view: WorkoutStep,
  stepIdx: number,
  blockType: BlockType,
): StructureStep {
  if (!base || !baseView) {
    const added = configStepToStructureStep(view, stepIdx, blockType);
    return blockType === "emom" ? { ...added, minuteIndex: null } : added;
  }
  const stepNumber = stepIdx + 1;
  let next: StructureStep = { ...base, stepNumber, minuteIndex: keptMinute(base, stepNumber, blockType) };
  if (view.type !== baseView.type) next = retypeStep(next, view);
  if (view.durationSeconds !== baseView.durationSeconds) {
    next = { ...next, targets: withDurationSeconds(next.targets, view.durationSeconds) };
  }
  return next;
}

function changedBlockFields(
  baseView: WorkoutStructureConfig,
  view: WorkoutStructureConfig,
  stepCount: number,
): Partial<StructureBlockInput> {
  const changes: Partial<StructureBlockInput> = {};
  // The editor shows "activation" as warmup and "quality" as steady. Only a
  // value the athlete actually picked replaces the stored one.
  if (view.section !== baseView.section) changes.sectionType = view.section;
  if (view.blockType !== baseView.blockType) changes.formatType = view.blockType;
  if (view.emomDurationMinutes !== baseView.emomDurationMinutes) {
    changes.durationMinutes = view.emomDurationMinutes ?? stepCount;
  }
  if (view.timeCapMinutes !== baseView.timeCapMinutes) changes.timeCapMinutes = view.timeCapMinutes ?? 10;
  if (view.roundCount !== baseView.roundCount) changes.roundCount = view.roundCount ?? 3;
  if (view.score !== baseView.score) changes.score = view.score ?? null;
  return changes;
}

/**
 * Apply an edited view onto the block it was loaded from. The view only knows
 * the fields the editor shows, and rebuilding the block from it dropped every
 * other one: step category, customLabel, stepRole, intensity, tempo, numeric
 * targets, block instructions and intervals, and "quality" / "activation"
 * came back as "steady" / "warmup". Here each step keeps its stored fields
 * (matched by the id `baseStepIds` gave it) and only what the athlete changed
 * is written. CL14 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function applyConfigToStructureBlock(
  base: StructureBlockInput,
  baseStepIds: readonly string[],
  view: WorkoutStructureConfig,
): StructureBlockInput {
  const baseView = structureBlockToConfig(base, baseStepIds);
  const baseSteps = new Map<string, StructureStep>();
  base.steps.forEach((step, stepIdx) => {
    const id = baseStepIds.at(stepIdx);
    if (id) baseSteps.set(id, step);
  });
  const baseViewSteps = new Map(baseView.steps.map((step) => [step.id, step]));
  const merged = view.steps.map((step, stepIdx) =>
    mergeStep(baseSteps.get(step.id), baseViewSteps.get(step.id), step, stepIdx, view.blockType),
  );
  const steps = view.blockType === "emom" ? placeEmomMinutes(merged, base.steps) : merged;
  return { ...base, ...changedBlockFields(baseView, view, steps.length), steps };
}
