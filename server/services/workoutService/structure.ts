import { randomUUID } from "node:crypto";

import {
  type ExerciseSet,
  exerciseSets,
  type InsertExerciseSet,
  type ParsedExercise,
  type StructureBlockInput,
  type StructureBlockScore,
  structureBlockScoreSchema,
  type StructureSetRelink,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";
import { seconds, secondsToMinutes, unitless } from "@shared/units";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "../../db";
import { AppError, ErrorCode } from "../../errors";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { getMutationOwnerAdapter } from "../../storage/exerciseSetOwners";
import { prescribedSetToLogRow, structureTargetsFromExerciseSet } from "../../storage/shared";
import {
  exerciseSetOwnerCondition,
  ownerColumns,
  ownerForeignKeys,
  structureBlockOwnerCondition,
} from "./owners";
import type { ReplaceStructureOptions, SetOwner, WorkoutTx } from "./types";

export function shouldDeriveStructureExerciseSets(explicitSetCount: number): boolean {
  return explicitSetCount <= 0;
}

export function structureReplacementOptions(explicitSetCount: number): ReplaceStructureOptions {
  return { deriveExerciseSets: shouldDeriveStructureExerciseSets(explicitSetCount) };
}

function synthesizeDefaultStructureBlocks(exercises: ParsedExercise[]): StructureBlockInput[] {
  if (exercises.length === 0) return [];
  const steps = exercises.map((ex, i) => ({
    stepNumber: i + 1,
    exerciseName: ex.exerciseName,
    category: ex.category,
    customLabel: ex.customLabel ?? null,
    stepType: "work" as const,
    stepRole: ex.stepRole ?? "steady",
    groupId: ex.groupId ?? null,
    groupMeta: null,
    targets: null,
  }));
  return [{ sectionType: "main", formatType: "steady", sortOrder: 0, steps }];
}

export function resolveStructureBlocksForPersist(args: {
  structureBlocks: StructureBlockInput[] | undefined;
  exercises: ParsedExercise[] | undefined;
  workoutSource: string | null | undefined;
  workoutLogId: string;
}): { blocks: StructureBlockInput[] | undefined; source: "structure_editor" | "legacy_synthesized" | "none" } {
  if (Array.isArray(args.structureBlocks)) {
    return { blocks: args.structureBlocks, source: "structure_editor" };
  }
  if (args.exercises && args.exercises.length > 0) {
    logger.warn({
      context: "workout-structure",
      event: "legacy_structure_synthesis_used",
      workoutLogId: args.workoutLogId,
      workoutSource: args.workoutSource ?? "manual",
      source: "legacy_synthesized",
    }, "Structure editor payload missing; synthesizing structure blocks from legacy exercise rows.");
    return { blocks: synthesizeDefaultStructureBlocks(args.exercises), source: "legacy_synthesized" };
  }
  return { blocks: undefined, source: "none" };
}

function numericTarget(targets: StructureBlockInput["steps"][number]["targets"], ...keys: string[]): number | null {
  if (!targets || typeof targets !== "object") return null;
  for (const key of keys) {
    const value = (targets as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function stringTarget(targets: StructureBlockInput["steps"][number]["targets"], key: string): string | null {
  if (!targets || typeof targets !== "object") return null;
  const value = (targets as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve a structure step's time target into `exercise_sets.time`, which is
 * MINUTES (see docs/adr-units.md).
 *
 * These three keys do not share a unit. `targetTime` and `time` are minutes,
 * matching the column and the athlete-facing "Time (min)" input. `durationSeconds`
 * is seconds -- the structure editor's field is labelled "Sec" and carries
 * `aria-label="... duration in seconds"`. All three used to be coalesced by a
 * single `numericTarget` call and returned verbatim, so a 45-second transition
 * entered the column as 45 MINUTES and `plannedSessionEstimate` added 45 minutes
 * of planned work to the session (audit C7).
 */
export function resolveStructureStepTimeTarget(targets: StructureBlockInput["steps"][number]["targets"]): number | null {
  const targetMinutes = numericTarget(targets, "targetTime", "time");
  if (targetMinutes != null) return targetMinutes;

  const targetSeconds = numericTarget(targets, "durationSeconds");
  return targetSeconds == null ? null : unitless(secondsToMinutes(seconds(targetSeconds)));
}

function isWorkStep(step: StructureBlockInput["steps"][number]): boolean {
  const type = (step.stepType ?? step.stepRole ?? "work").toLowerCase();
  return type !== "rest" && !!step.exerciseName?.trim();
}

function derivedSetRowFromStep(
  owner: SetOwner,
  blockId: string,
  block: StructureBlockInput,
  step: StructureBlockInput["steps"][number],
  sortOrder: number,
): InsertExerciseSet | null {
  if (!isWorkStep(step)) return null;
  const targets = step.targets;
  const reps = numericTarget(targets, "targetReps", "reps");
  const time = resolveStructureStepTimeTarget(targets);
  const distance = numericTarget(targets, "targetDistance", "distance");
  const weight = numericTarget(targets, "targetWeight", "weight");
  return {
    ...ownerColumns(owner),
    exerciseName: step.exerciseName!.trim(),
    customLabel: step.customLabel ?? null,
    category: step.category ?? "conditioning",
    setNumber: 1,
    reps,
    weight,
    distance,
    time,
    blockId,
    stepNumber: step.stepNumber,
    intervalMinute: step.minuteIndex ?? null,
    stepRole: step.stepRole ?? step.stepType ?? "work",
    groupId: step.groupId ?? null,
    intensity: step.intensity ?? null,
    repMode: null,
    tempo: step.tempo ?? null,
    standards: null,
    notes: stringTarget(targets, "instructions") ?? block.instructions ?? null,
    sortOrder,
  };
}

async function nextSortOrderForOwner(tx: WorkoutTx, owner: SetOwner): Promise<number> {
  const [max] = await tx
    .select({ maxOrder: sql<number | null>`max(${exerciseSets.sortOrder})` })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner));
  return (max?.maxOrder ?? -1) + 1;
}

async function deleteBlockDerivedExerciseSets(tx: WorkoutTx, owner: SetOwner): Promise<void> {
  await tx
    .delete(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)));
}

async function ownerHasExerciseSets(tx: WorkoutTx, owner: SetOwner): Promise<boolean> {
  const [row] = await tx
    .select({ id: exerciseSets.id })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner))
    .limit(1);
  return !!row;
}

function structureStepKey(blockId: string | null, stepNumber: number | null): string | null {
  if (!blockId || stepNumber == null) return null;
  return `${blockId}:${stepNumber}`;
}

async function linkedExerciseRowsByStep(tx: WorkoutTx, owner: SetOwner) {
  const rows = await tx
    .select()
    .from(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)))
    .orderBy(asc(exerciseSets.sortOrder));
  const byStep = new Map<string, ExerciseSet>();
  for (const row of rows) {
    const key = structureStepKey(row.blockId, row.stepNumber);
    if (key && !byStep.has(key)) byStep.set(key, row);
  }
  return byStep;
}

async function mirrorStructureStepsFromExerciseRows(
  tx: WorkoutTx,
  owner: SetOwner,
  blocks: StructureBlockInput[],
): Promise<StructureBlockInput[]> {
  const linkedRows = await linkedExerciseRowsByStep(tx, owner);
  if (linkedRows.size === 0) return blocks;
  return blocks.map((block) => ({
    ...block,
    steps: block.steps.map((step) => {
      if ((step.stepType ?? "work") !== "work" || !block.id) return step;
      const linked = linkedRows.get(`${block.id}:${step.stepNumber}`);
      if (!linked) return step;
      return {
        ...step,
        exerciseName: linked.exerciseName,
        category: linked.category,
        customLabel: linked.customLabel,
        stepRole: step.stepRole ?? linked.stepRole ?? "work",
        groupId: step.groupId ?? linked.groupId,
        targets: step.targets ?? structureTargetsFromExerciseSet(linked),
      };
    }),
  }));
}

/** The link columns of a row whose step is gone. */
const UNLINKED_STRUCTURE_SET = {
  blockId: null,
  stepNumber: null,
  intervalMinute: null,
  cycleNumber: null,
  stepRole: null,
  groupId: null,
} as const;

async function clearStaleStructureSetLinks(
  tx: WorkoutTx,
  owner: SetOwner,
  validStepKeys: ReadonlySet<string>,
): Promise<void> {
  const rows = await tx
    .select({ id: exerciseSets.id, blockId: exerciseSets.blockId, stepNumber: exerciseSets.stepNumber })
    .from(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)));
  const staleIds = rows
    .filter((row) => {
      const key = structureStepKey(row.blockId, row.stepNumber);
      return !key || !validStepKeys.has(key);
    })
    .map((row) => row.id);
  if (staleIds.length === 0) return;
  await tx
    .update(exerciseSets)
    .set(UNLINKED_STRUCTURE_SET)
    .where(inArray(exerciseSets.id, staleIds));
}

interface RelinkGroup {
  readonly fromBlockId: string;
  readonly fromStepNumber: number;
  readonly values: Partial<InsertExerciseSet>;
  readonly setIds: string[];
}

function relinkValues(relink: StructureSetRelink): Partial<InsertExerciseSet> {
  if (relink.blockId === null || relink.stepNumber === null) return UNLINKED_STRUCTURE_SET;
  return {
    blockId: relink.blockId,
    stepNumber: relink.stepNumber,
    ...(relink.intervalMinute === undefined ? {} : { intervalMinute: relink.intervalMinute }),
    ...(relink.cycleNumber === undefined ? {} : { cycleNumber: relink.cycleNumber }),
  };
}

/** Relinks that write the same values from the same step, so each group is one UPDATE. */
function groupRelinks(relinks: readonly StructureSetRelink[]): RelinkGroup[] {
  const groups = new Map<string, RelinkGroup>();
  for (const relink of relinks) {
    const values = relinkValues(relink);
    const key = JSON.stringify([relink.fromBlockId, relink.fromStepNumber, values]);
    const group = groups.get(key);
    if (group) {
      group.setIds.push(relink.setId);
    } else {
      groups.set(key, {
        fromBlockId: relink.fromBlockId,
        fromStepNumber: relink.fromStepNumber,
        values,
        setIds: [relink.setId],
      });
    }
  }
  return [...groups.values()];
}

function isOwnedBy(row: Pick<ExerciseSet, "workoutLogId" | "planDayId">, owner: SetOwner): boolean {
  return "workoutLogId" in owner ? row.workoutLogId === owner.workoutLogId : row.planDayId === owner.planDayId;
}

/**
 * Move the owner's rows along with the steps a structure edit renumbered, in
 * the transaction that saves the edit, so the rows and the steps change
 * together or not at all. A set that belongs to anyone but `owner` fails the
 * whole save before anything is written. A set that no longer exists was
 * deleted after the client computed the relinks: there is nothing left to
 * move, so it is skipped rather than failing the save, which reverted the
 * athlete's block edit over a row they had just removed. A row whose link is
 * no longer the one the client saw was relinked by a newer write since, and
 * is left where that write put it. CL15 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function applyStructureSetRelinks(
  tx: WorkoutTx,
  owner: SetOwner,
  relinks: readonly StructureSetRelink[],
): Promise<void> {
  if (relinks.length === 0) return;
  const setIds = relinks.map((relink) => relink.setId);
  const existing = await tx
    .select({ workoutLogId: exerciseSets.workoutLogId, planDayId: exerciseSets.planDayId })
    .from(exerciseSets)
    .where(inArray(exerciseSets.id, setIds));
  if (existing.some((row) => !isOwnedBy(row, owner))) {
    throw new AppError(ErrorCode.NOT_FOUND, "Exercise set not found", 404);
  }
  // The owner condition below also leaves the deleted ones untouched.
  for (const group of groupRelinks(relinks)) {
    await tx
      .update(exerciseSets)
      .set(group.values)
      .where(and(
        exerciseSetOwnerCondition(owner),
        inArray(exerciseSets.id, group.setIds),
        eq(exerciseSets.blockId, group.fromBlockId),
        eq(exerciseSets.stepNumber, group.fromStepNumber),
      ));
  }
}

function structureBlockInsertValues(owner: SetOwner, block: StructureBlockInput, idx: number) {
  return {
    ...(block.id ? { id: block.id } : {}),
    ...ownerForeignKeys(owner),
    sectionType: block.sectionType,
    formatType: block.formatType,
    durationSeconds: block.durationSeconds ?? null,
    rounds: block.rounds ?? null,
    workSeconds: block.workSeconds ?? null,
    restSeconds: block.restSeconds ?? null,
    durationMinutes: block.durationMinutes ?? null,
    roundCount: block.roundCount ?? null,
    timeCapMinutes: block.timeCapMinutes ?? null,
    workIntervalSec: block.workIntervalSec ?? null,
    restIntervalSec: block.restIntervalSec ?? null,
    score: block.score ?? null,
    sequenceOrder: block.sequenceOrder ?? idx,
    instructions: block.instructions ?? null,
    sortOrder: block.sortOrder ?? idx,
  };
}

function structureStepInsertValues(blockId: string, steps: StructureBlockInput["steps"]) {
  return steps.map((s) => ({
    blockId,
    stepNumber: s.stepNumber,
    minuteIndex: s.minuteIndex ?? null,
    stepType: s.stepType ?? "work",
    exerciseName: s.exerciseName,
    category: s.category,
    customLabel: s.customLabel ?? null,
    stepRole: s.stepRole ?? null,
    targetReps: s.targets?.targetReps ?? s.targets?.reps ?? null,
    targetTime: s.targets?.targetTime ?? s.targets?.time ?? null,
    targetDistance: s.targets?.targetDistance ?? s.targets?.distance ?? null,
    targetWeight: s.targets?.targetWeight ?? s.targets?.weight ?? null,
    groupId: s.groupId ?? null,
    groupMeta: s.groupMeta ?? null,
    intensity: s.intensity ?? null,
    loadMode: s.loadMode ?? null,
    unilateralMode: s.unilateralMode ?? null,
    tempo: s.tempo ?? null,
    constraintTags: s.constraintTags ?? null,
    targets: s.targets ?? null,
  }));
}

function collectDerivedRowsForBlock(args: {
  owner: SetOwner;
  blockId: string;
  block: StructureBlockInput;
  startSortOrder: number;
}): { rows: InsertExerciseSet[]; nextSortOrder: number } {
  const rows: InsertExerciseSet[] = [];
  let sortOrder = args.startSortOrder;
  for (const step of args.block.steps) {
    const row = derivedSetRowFromStep(args.owner, args.blockId, args.block, step, sortOrder);
    if (!row) continue;
    rows.push(row);
    sortOrder += 1;
  }
  return { rows, nextSortOrder: sortOrder };
}

/**
 * Fans the persisted blocks out into the three row sets the caller needs:
 * the structure-step inserts, the exercise-set rows derived from those steps
 * (only when this owner's sets are block-derived), and the `blockId:stepNumber`
 * keys that stay valid, used to prune links to steps that no longer exist.
 */
function collectStructurePersistRows(args: {
  owner: SetOwner;
  blocks: StructureBlockInput[];
  blockIds: string[];
  deriveExerciseSets: boolean;
  startSortOrder: number;
}): {
  stepRows: ReturnType<typeof structureStepInsertValues>;
  derivedRows: InsertExerciseSet[];
  validStepKeys: Set<string>;
} {
  const stepRows: ReturnType<typeof structureStepInsertValues> = [];
  const derivedRows: InsertExerciseSet[] = [];
  const validStepKeys = new Set<string>();
  let sortOrder = args.startSortOrder;

  for (const [idx, block] of args.blocks.entries()) {
    const blockId = args.blockIds[idx];
    const steps = block.steps ?? [];
    if (steps.length === 0) continue;
    for (const step of steps) {
      validStepKeys.add(`${blockId}:${step.stepNumber}`);
    }
    stepRows.push(...structureStepInsertValues(blockId, steps));
    if (!args.deriveExerciseSets) continue;
    const derived = collectDerivedRowsForBlock({ owner: args.owner, blockId, block, startSortOrder: sortOrder });
    derivedRows.push(...derived.rows);
    sortOrder = derived.nextSortOrder;
  }

  return { stepRows, derivedRows, validStepKeys };
}

export async function replaceStructureForOwner(
  tx: WorkoutTx,
  owner: SetOwner,
  structureBlocks: StructureBlockInput[],
  options: ReplaceStructureOptions = {},
): Promise<number> {
  const deriveExerciseSets = options.deriveExerciseSets ?? !(await ownerHasExerciseSets(tx, owner));
  if (deriveExerciseSets) await deleteBlockDerivedExerciseSets(tx, owner);
  const blocksForPersist = deriveExerciseSets
    ? structureBlocks
    : await mirrorStructureStepsFromExerciseRows(tx, owner, structureBlocks);
  await tx.delete(workoutStructureBlocks).where(structureBlockOwnerCondition(owner));
  if (blocksForPersist.length === 0) {
    if (!deriveExerciseSets) await clearStaleStructureSetLinks(tx, owner, new Set());
    return 0;
  }

  const startSortOrder = deriveExerciseSets ? await nextSortOrderForOwner(tx, owner) : 0;

  // ⚡ Bolt Optimization: the old loop awaited one `INSERT ... RETURNING` per
  // block plus one `INSERT` for that block's steps, sequentially, inside the
  // transaction backing every "Log Workout" save — up to 2N DB round trips
  // for N blocks, all on that request's critical path. Block IDs don't need
  // to come back from the DB: they're generated app-side with randomUUID()
  // (the column's `gen_random_uuid()` default is just a fallback for callers
  // that don't supply one), so every block's insert values and its steps'
  // blockId can be built up front and sent as two batched multi-row INSERTs
  // instead — 2 round trips total regardless of block count.
  const blockIds = blocksForPersist.map((block) => block.id ?? randomUUID());
  await tx.insert(workoutStructureBlocks).values(
    blocksForPersist.map((block, idx) => structureBlockInsertValues(owner, { ...block, id: blockIds[idx] }, idx)),
  );

  const { stepRows, derivedRows, validStepKeys } = collectStructurePersistRows({
    owner,
    blocks: blocksForPersist,
    blockIds,
    deriveExerciseSets,
    startSortOrder,
  });
  if (stepRows.length > 0) {
    await tx.insert(workoutStructureSteps).values(stepRows);
  }

  if (derivedRows.length > 0) {
    await tx.insert(exerciseSets).values(derivedRows);
  }
  if (!deriveExerciseSets) await clearStaleStructureSetLinks(tx, owner, validStepKeys);
  return derivedRows.length;
}

export async function replaceWorkoutStructure(
  tx: WorkoutTx,
  workoutLogId: string,
  structureBlocks: StructureBlockInput[],
  options?: ReplaceStructureOptions,
): Promise<number> {
  return replaceStructureForOwner(tx, { workoutLogId }, structureBlocks, options);
}

/**
 * When a workout is logged against a plan day and the client didn't supply
 * exercises, copy the plan day's prescribed exerciseSets into the new log
 * as starter rows. Inline rather than delegating to
 * storage.workouts.seedExerciseSetsFromPlanDay because that method opens
 * its own transaction and can't nest inside `tx`. Returns an empty array
 * when the plan day has no prescribed rows (e.g., rest days, or a plan
 * generated before structured exercises shipped).
 *
 * `preferences` stamps only rows the plan day never stamped; every other copy
 * keeps the unit its prescription was written in (see prescribedSetToLogRow).
 */
export async function copyPrescribedSetsIntoLog(
  tx: WorkoutTx,
  planDayId: string,
  workoutLogId: string,
  blockIdMap: Map<string, string>,
  preferences: UnitPreferences,
): Promise<ExerciseSet[]> {
  const prescribed = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, planDayId))
    .orderBy(asc(exerciseSets.sortOrder));
  if (prescribed.length === 0) return [];

  const copyRows = prescribed.map((p) => {
    const mappedBlockId = p.blockId ? blockIdMap.get(p.blockId) ?? null : null;
    return {
      ...prescribedSetToLogRow(p, workoutLogId, preferences),
      blockId: mappedBlockId,
      stepNumber: mappedBlockId ? p.stepNumber : null,
      intervalMinute: mappedBlockId ? p.intervalMinute : null,
      cycleNumber: mappedBlockId ? p.cycleNumber : null,
      stepRole: mappedBlockId ? p.stepRole : null,
      groupId: mappedBlockId ? p.groupId : null,
    };
  });
  return tx.insert(exerciseSets).values(copyRows).returning();
}

export async function copyPrescribedStructureIntoLog(
  tx: WorkoutTx,
  planDayId: string,
  workoutLogId: string,
): Promise<Map<string, string>> {
  const blockIdMap = new Map<string, string>();
  const blocks = await tx
    .select()
    .from(workoutStructureBlocks)
    .where(eq(workoutStructureBlocks.planDayId, planDayId))
    .orderBy(asc(workoutStructureBlocks.sortOrder));
  if (blocks.length === 0) return blockIdMap;

  const steps = await tx
    .select()
    .from(workoutStructureSteps)
    .where(inArray(workoutStructureSteps.blockId, blocks.map((b) => b.id)))
    .orderBy(asc(workoutStructureSteps.stepNumber));
  const stepsByBlock = new Map<string, typeof steps>();
  for (const step of steps) {
    const arr = stepsByBlock.get(step.blockId) ?? [];
    arr.push(step);
    stepsByBlock.set(step.blockId, arr);
  }

  // ⚡ Bolt Optimization: this loop used to await one `INSERT ... RETURNING`
  // per block plus one `INSERT` for that block's steps, sequentially, inside
  // the transaction backing every "Log Workout" save when logging against a
  // plan day -- up to 2N round trips for N blocks on that request's critical
  // path (the exact pattern already fixed in replaceStructureForOwner above,
  // flagged there as "not yet fixed but same shape" for this function).
  // workout_structure_blocks.id is a varchar with a gen_random_uuid() column
  // *default*, not a generated-always identity column, so the new id can be
  // generated app-side up front instead of read back from a RETURNING clause
  // -- collapsing the loop to 2 batched multi-row INSERTs total, regardless
  // of block count.
  for (const block of blocks) {
    blockIdMap.set(block.id, randomUUID());
  }
  await tx.insert(workoutStructureBlocks).values(blocks.map((block) => ({
    id: blockIdMap.get(block.id)!,
    workoutLogId,
    planDayId: null,
    sectionType: block.sectionType,
    formatType: block.formatType,
    durationSeconds: block.durationSeconds,
    rounds: block.rounds,
    workSeconds: block.workSeconds,
    restSeconds: block.restSeconds,
    durationMinutes: block.durationMinutes,
    roundCount: block.roundCount,
    timeCapMinutes: block.timeCapMinutes,
    workIntervalSec: block.workIntervalSec,
    restIntervalSec: block.restIntervalSec,
    score: null,
    sequenceOrder: block.sequenceOrder,
    instructions: block.instructions,
    sortOrder: block.sortOrder,
  })));

  const stepRows: (typeof workoutStructureSteps.$inferInsert)[] = [];
  for (const block of blocks) {
    const blockSteps = stepsByBlock.get(block.id) ?? [];
    const newBlockId = blockIdMap.get(block.id)!;
    for (const step of blockSteps) {
      stepRows.push({
        blockId: newBlockId,
        stepNumber: step.stepNumber,
        minuteIndex: step.minuteIndex,
        stepType: step.stepType,
        exerciseName: step.exerciseName,
        category: step.category,
        customLabel: step.customLabel,
        targetReps: step.targetReps,
        targetTime: step.targetTime,
        targetDistance: step.targetDistance,
        targetWeight: step.targetWeight,
        targets: step.targets,
        stepRole: step.stepRole,
        intensity: step.intensity,
        loadMode: step.loadMode,
        unilateralMode: step.unilateralMode,
        tempo: step.tempo,
        constraintTags: step.constraintTags,
        groupId: step.groupId,
        groupMeta: step.groupMeta,
      });
    }
  }
  if (stepRows.length > 0) {
    await tx.insert(workoutStructureSteps).values(stepRows);
  }

  return blockIdMap;
}

// ⚡ Bolt Optimization: Consolidate arrays into a single Map to prevent intermediate Set array
// allocations and unnecessary multi-pass iteration loops, improving adherence calculation speed.

export async function replacePlanDayStructure(
  planDayId: string,
  userId: string,
  structureBlocks: StructureBlockInput[],
  relinks: readonly StructureSetRelink[] = [],
): Promise<{ exerciseSets: ExerciseSet[]; structureBlocks: StructureBlockInput[] } | null> {
  const owner = { planDayId };
  const saved = await db.transaction(async (tx) => {
    // The plan-day row lock serializes two saves of this day's blocks. Without
    // it the second one's insert could collide with the first one's block ids
    // (the client re-sends them) while the first was still committing
    // (U3, CL15, CODEBASE_ANALYSIS_2026-10-03).
    const adapter = getMutationOwnerAdapter({ kind: "planDay", id: planDayId, userId });
    if (!(await adapter.lockOwnedContainer(tx, planDayId, userId))) return false;
    await applyStructureSetRelinks(tx, owner, relinks);
    await replaceStructureForOwner(tx, owner, structureBlocks);
    return true;
  });
  if (!saved) return null;
  const [exerciseSetsForDay, savedStructure] = await Promise.all([
    storage.workouts.getExerciseSetsByPlanDay(planDayId, userId),
    storage.workouts.getWorkoutStructureByPlanDay(planDayId, userId),
  ]);
  return {
    exerciseSets: exerciseSetsForDay ?? [],
    structureBlocks: savedStructure ?? [],
  };
}

async function deriveMissingExerciseSetsFromStructure(
  owner: SetOwner,
  structureBlocks: StructureBlockInput[],
): Promise<number> {
  const existing = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner));
  if ((existing[0]?.count ?? 0) > 0) return 0;
  if (structureBlocks.length === 0) return 0;
  await db.transaction((tx) => replaceStructureForOwner(tx, owner, structureBlocks, { deriveExerciseSets: true }));
  const after = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner));
  return after[0]?.count ?? 0;
}

export async function deriveMissingPlanDaySetsFromStructure(
  planDayId: string,
  userId: string,
): Promise<number | null> {
  const planDay = await storage.plans.getPlanDay(planDayId, userId);
  if (!planDay) return null;
  const structureBlocks = await storage.workouts.getWorkoutStructureByPlanDay(planDayId, userId);
  return deriveMissingExerciseSetsFromStructure({ planDayId }, structureBlocks ?? []);
}

export async function deriveMissingWorkoutSetsFromStructure(
  workoutLogId: string,
  userId: string,
): Promise<number | null> {
  const log = await storage.workouts.getWorkoutLog(workoutLogId, userId);
  if (!log) return null;
  const structureBlocks = await storage.workouts.getWorkoutStructureByWorkoutLog(workoutLogId);
  return deriveMissingExerciseSetsFromStructure({ workoutLogId }, structureBlocks);
}

export async function updateWorkoutStructureBlockScore(
  workoutId: string,
  blockId: string,
  userId: string,
  score: StructureBlockScore | null,
): Promise<StructureBlockInput[] | null> {
  const [block] = await db
    .select({ id: workoutStructureBlocks.id, formatType: workoutStructureBlocks.formatType })
    .from(workoutStructureBlocks)
    .innerJoin(workoutLogs, eq(workoutStructureBlocks.workoutLogId, workoutLogs.id))
    .where(and(
      eq(workoutStructureBlocks.id, blockId),
      eq(workoutStructureBlocks.workoutLogId, workoutId),
      eq(workoutLogs.userId, userId),
    ))
    .limit(1);
  if (!block) return null;

  const parsedScore = score === null ? null : structureBlockScoreSchema.parse(score);
  if (parsedScore && parsedScore.type !== block.formatType) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Block score type must match the block format.", 400);
  }

  await db
    .update(workoutStructureBlocks)
    .set({ score: parsedScore })
    .where(eq(workoutStructureBlocks.id, block.id));
  return storage.workouts.getWorkoutStructureByWorkoutLog(workoutId);
}
