import {
  type ExerciseSet,
  exerciseSets,
  type InsertExerciseSet,
  type ParsedExercise,
  type StructureBlockInput,
  type StructureBlockScore,
  structureBlockScoreSchema,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "../../db";
import { AppError, ErrorCode } from "../../errors";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { prescribedSetToLogRow } from "../../storage/shared";
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

export function resolveStructureStepTimeTarget(targets: StructureBlockInput["steps"][number]["targets"]): number | null {
  return numericTarget(targets, "targetTime", "time", "durationSeconds");
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

function targetsFromLinkedExerciseSet(row: ExerciseSet): NonNullable<StructureBlockInput["steps"][number]["targets"]> | null {
  const targets: Record<string, unknown> = {};
  const reps = row.plannedReps ?? row.reps;
  const weight = row.plannedWeight ?? row.weight;
  const distance = row.plannedDistance ?? row.distance;
  const time = row.plannedTime ?? row.time;
  if (reps != null) targets.targetReps = reps;
  if (weight != null) targets.targetWeight = weight;
  if (distance != null) targets.targetDistance = distance;
  if (time != null) targets.targetTime = time;
  return Object.keys(targets).length > 0
    ? (targets as NonNullable<StructureBlockInput["steps"][number]["targets"]>)
    : null;
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
        targets: step.targets ?? targetsFromLinkedExerciseSet(linked),
      };
    }),
  }));
}

async function clearStaleStructureSetLinks(
  tx: WorkoutTx,
  owner: SetOwner,
  validStepKeys: ReadonlySet<string>,
): Promise<void> {
  const rows = await tx
    .select({ id: exerciseSets.id, blockId: exerciseSets.blockId, stepNumber: exerciseSets.stepNumber })
    .from(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)));
  for (const row of rows) {
    const key = structureStepKey(row.blockId, row.stepNumber);
    if (key && validStepKeys.has(key)) continue;
    await tx
      .update(exerciseSets)
      .set({
        blockId: null,
        stepNumber: null,
        intervalMinute: null,
        cycleNumber: null,
        stepRole: null,
        groupId: null,
      })
      .where(eq(exerciseSets.id, row.id));
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

async function insertStructureBlock(
  tx: WorkoutTx,
  owner: SetOwner,
  block: StructureBlockInput,
  idx: number,
) {
  const [savedBlock] = await tx.insert(workoutStructureBlocks).values(
    structureBlockInsertValues(owner, block, idx),
  ).returning();
  return savedBlock;
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

  let sortOrder = deriveExerciseSets ? await nextSortOrderForOwner(tx, owner) : 0;
  const derivedRows: InsertExerciseSet[] = [];
  const validStepKeys = new Set<string>();
  for (const [idx, block] of blocksForPersist.entries()) {
    const savedBlock = await insertStructureBlock(tx, owner, block, idx);
    const steps = block.steps ?? [];
    if (steps.length === 0) continue;
    for (const step of steps) {
      validStepKeys.add(`${savedBlock.id}:${step.stepNumber}`);
    }
    await tx.insert(workoutStructureSteps).values(structureStepInsertValues(savedBlock.id, steps));
    if (deriveExerciseSets) {
      const derived = collectDerivedRowsForBlock({ owner, blockId: savedBlock.id, block, startSortOrder: sortOrder });
      derivedRows.push(...derived.rows);
      sortOrder = derived.nextSortOrder;
    }
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
 */
export async function copyPrescribedSetsIntoLog(
  tx: WorkoutTx,
  planDayId: string,
  workoutLogId: string,
  blockIdMap: Map<string, string>,
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
      ...prescribedSetToLogRow(p, workoutLogId),
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

  for (const block of blocks) {
    const [savedBlock] = await tx.insert(workoutStructureBlocks).values({
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
    }).returning();
    blockIdMap.set(block.id, savedBlock.id);
    const blockSteps = stepsByBlock.get(block.id) ?? [];
    if (blockSteps.length === 0) continue;
    await tx.insert(workoutStructureSteps).values(blockSteps.map((step) => ({
      blockId: savedBlock.id,
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
    })));
  }

  return blockIdMap;
}

// ⚡ Bolt Optimization: Consolidate arrays into a single Map to prevent intermediate Set array
// allocations and unnecessary multi-pass iteration loops, improving adherence calculation speed.

export async function replacePlanDayStructure(
  planDayId: string,
  userId: string,
  structureBlocks: StructureBlockInput[],
): Promise<{ exerciseSets: ExerciseSet[]; structureBlocks: StructureBlockInput[] } | null> {
  const planDay = await storage.plans.getPlanDay(planDayId, userId);
  if (!planDay) return null;
  await db.transaction((tx) => replaceStructureForOwner(tx, { planDayId }, structureBlocks));
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
