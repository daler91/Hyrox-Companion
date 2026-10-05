import type { ExerciseSet, StructureBlockInput, StructureSetRelink } from "@shared/schema";

import type { SetData, StructuredExercise } from "@/lib/structuredExercise";
import { blockStepValue } from "@/lib/workoutStructureAssignments";

/**
 * One step a structure edit renumbered. Exercise rows link to a step by
 * `blockId` + `stepNumber`, so when a step moves or goes away the rows linked
 * to it have to follow, or the save copies step names from whichever rows now
 * sit at each number and unlinks the rest (CL15, CODEBASE_ANALYSIS_2026-10-03).
 */
export interface StepLinkMove {
  readonly blockId: string;
  readonly fromStepNumber: number;
  /** Null when the step was removed: its rows are unlinked, not handed to another step. */
  readonly toStepNumber: number | null;
  /** The step's EMOM minute before and after the edit; absent outside an EMOM. */
  readonly fromMinuteIndex?: number | null;
  readonly toMinuteIndex?: number | null;
  /**
   * How many minutes one pass of the EMOM pattern takes before and after the
   * edit (emomPatternLength); absent outside an EMOM. A step whose number and
   * minute stay put still moves when this changes: its rows in later cycles do.
   */
  readonly fromPatternLength?: number | null;
  readonly toPatternLength?: number | null;
}

/**
 * A saved row following its step, sent in the same request as the blocks so
 * the two change together (CL15). The server applies it only while the row
 * still has the link it names, so a newer write to that row wins.
 */
export type SetRelink = StructureSetRelink;

type LinkFields = Pick<
  ExerciseSet,
  "blockId" | "stepNumber" | "intervalMinute" | "cycleNumber" | "stepRole" | "groupId"
>;

interface StepLink {
  readonly blockId?: string | null;
  readonly stepNumber?: number | null;
  readonly intervalMinute?: number | null;
}

const UNLINKED: LinkFields = {
  blockId: null,
  stepNumber: null,
  intervalMinute: null,
  cycleNumber: null,
  stepRole: null,
  groupId: null,
};

function movesByStep(moves: readonly StepLinkMove[]): Map<string, StepLinkMove> {
  return new Map(moves.map((move) => [blockStepValue(move.blockId, move.fromStepNumber), move]));
}

function moveFor(
  link: StepLink,
  moves: ReadonlyMap<string, StepLinkMove>,
): StepLinkMove | undefined {
  if (!link.blockId || link.stepNumber == null) return undefined;
  return moves.get(blockStepValue(link.blockId, link.stepNumber));
}

/**
 * How many minutes one pass of an EMOM's pattern takes: one per step, or up to
 * the last minute a step holds when the stored pattern skips minutes (2, 4, 6).
 * Null outside an EMOM.
 */
export function emomPatternLength(block: StructureBlockInput): number | null {
  if (block.formatType !== "emom") return null;
  return block.steps.reduce(
    (length, step) => Math.max(length, step.minuteIndex ?? 0),
    block.steps.length,
  );
}

/**
 * The row's minute once its step moved. A row in a later EMOM cycle sits whole
 * patterns after its step's minute, so it keeps its cycle and lands that many
 * NEW patterns after the step's new minute; taking the step's minute put every
 * cycle's row on the first cycle's minute, and shifting by the step's own move
 * ignored the pattern growing or shrinking (removing one step of three left a
 * cycle-2 row a minute late). CL15 (CODEBASE_ANALYSIS_2026-10-03)
 */
function shiftedMinute(rowMinute: number | null | undefined, move: StepLinkMove): number | null {
  const from = move.fromMinuteIndex ?? null;
  const to = move.toMinuteIndex ?? null;
  if (from === null && to === null) return rowMinute ?? null;
  if (from === null || to === null || rowMinute == null || rowMinute < from) return to;
  const fromLength = move.fromPatternLength ?? null;
  const toLength = move.toPatternLength ?? fromLength;
  // Without the pattern's length, only the step's own shift is known.
  if (!fromLength || !toLength) return rowMinute + (to - from);
  return to + Math.floor((rowMinute - from) / fromLength) * toLength;
}

/** Whether the relinked link is the one the row already has. */
function isSameLink(link: StepLink, move: StepLinkMove, minute: number | null): boolean {
  return move.toStepNumber === link.stepNumber && minute === (link.intervalMinute ?? null);
}

function relinkForMove(
  setId: string,
  move: StepLinkMove,
  rowMinute: number | null | undefined,
): SetRelink {
  const from = { setId, fromBlockId: move.blockId, fromStepNumber: move.fromStepNumber };
  if (move.toStepNumber === null) return { ...from, blockId: null, stepNumber: null };
  // cycleNumber is the row's own round: the step moving doesn't change it.
  return {
    ...from,
    blockId: move.blockId,
    stepNumber: move.toStepNumber,
    intervalMinute: shiftedMinute(rowMinute, move),
  };
}

/** The link fields a relink writes; mirrors applyStructureSetRelinks on the server. */
function relinkedFields(relink: SetRelink): Partial<LinkFields> {
  if (relink.blockId === null || relink.stepNumber === null) return UNLINKED;
  return {
    blockId: relink.blockId,
    stepNumber: relink.stepNumber,
    ...(relink.intervalMinute === undefined ? {} : { intervalMinute: relink.intervalMinute }),
    ...(relink.cycleNumber === undefined ? {} : { cycleNumber: relink.cycleNumber }),
  };
}

/** The relinks that keep saved rows on the steps they were linked to. */
export function relinksForSets(
  sets: readonly ExerciseSet[],
  moves: readonly StepLinkMove[],
): SetRelink[] {
  if (moves.length === 0) return [];
  const byStep = movesByStep(moves);
  const relinks: SetRelink[] = [];
  for (const set of sets) {
    const move = moveFor(set, byStep);
    if (move && !isSameLink(set, move, shiftedMinute(set.intervalMinute, move))) {
      relinks.push(relinkForMove(set.id, move, set.intervalMinute));
    }
  }
  return relinks;
}

/** The rows as the server leaves them once `relinks` land: the optimistic copy of the save. */
export function applySetRelinks(sets: ExerciseSet[], relinks: readonly SetRelink[]): ExerciseSet[] {
  if (relinks.length === 0) return sets;
  const byId = new Map(relinks.map((relink) => [relink.setId, relink]));
  return sets.map((set) => {
    const relink = byId.get(set.id);
    if (!relink || set.blockId !== relink.fromBlockId || set.stepNumber !== relink.fromStepNumber)
      return set;
    return { ...set, ...relinkedFields(relink) };
  });
}

function linkFieldsOf(set: LinkFields): LinkFields {
  return {
    blockId: set.blockId,
    stepNumber: set.stepNumber,
    intervalMinute: set.intervalMinute,
    cycleNumber: set.cycleNumber,
    stepRole: set.stepRole,
    groupId: set.groupId,
  };
}

/**
 * Undo applySetRelinks after the save failed: each row it moved goes back to
 * the link it had in `before`, unless a newer write has moved it since.
 */
export function revertSetRelinks(
  sets: ExerciseSet[],
  relinks: readonly SetRelink[],
  before: readonly ExerciseSet[],
): ExerciseSet[] {
  if (relinks.length === 0) return sets;
  const byId = new Map(relinks.map((relink) => [relink.setId, relink]));
  const beforeById = new Map(before.map((set) => [set.id, set]));
  return sets.map((set) => {
    const relink = byId.get(set.id);
    const prior = beforeById.get(set.id);
    if (!relink || !prior || set.blockId !== relink.blockId || set.stepNumber !== relink.stepNumber)
      return set;
    return { ...set, ...linkFieldsOf(prior) };
  });
}

function draftLinkAfter(
  move: StepLinkMove,
  rowMinute: number | null | undefined,
): Partial<LinkFields> {
  if (move.toStepNumber === null) return UNLINKED;
  return {
    blockId: move.blockId,
    stepNumber: move.toStepNumber,
    intervalMinute: shiftedMinute(rowMinute, move),
  };
}

/** The draft exercise with its sets moved along with their steps; the same object when none moved. */
export function relinkDraftExercise(
  exercise: StructuredExercise,
  moves: readonly StepLinkMove[],
): StructuredExercise {
  if (moves.length === 0) return exercise;
  const byStep = movesByStep(moves);
  let changed = false;
  const sets: SetData[] = [];
  for (const set of exercise.sets) {
    const move = moveFor(set, byStep);
    const follows =
      move !== undefined && !isSameLink(set, move, shiftedMinute(set.intervalMinute, move));
    if (follows) changed = true;
    sets.push(follows ? { ...set, ...draftLinkAfter(move, set.intervalMinute) } : set);
  }
  return changed ? { ...exercise, sets } : exercise;
}
