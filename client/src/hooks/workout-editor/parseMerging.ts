import { EXERCISE_DEFINITIONS, type ExerciseName, normalizeExerciseName, type ParsedExercise } from "@shared/schema";
import type { MutableRefObject } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";

import { makeBlockId } from "./blockHelpers";

interface ParsedBlockBuild {
  readonly exerciseName: ExerciseName;
  readonly blockKey: string;
  readonly data: StructuredExercise;
}

function buildBlockFromParsed(ex: ParsedExercise): ParsedBlockBuild {
  const normalizedName = normalizeExerciseName(ex.exerciseName);
  const isLegacyEmom = normalizedName === "emom";
  const isKnown = normalizedName !== null && !isLegacyEmom;
  const exName = (isKnown ? normalizedName : "custom");
  const customLabel = isKnown ? undefined : (ex.customLabel || ex.exerciseName);
  const blockKey = exName === "custom" ? `custom:${customLabel ?? ""}` : exName;

  return {
    exerciseName: exName,
    blockKey,
    data: {
      exerciseName: exName,
      category: isKnown ? EXERCISE_DEFINITIONS[exName].category : ex.category,
      customLabel,
      confidence: ex.confidence,
      missingFields: ex.missingFields,
      sets: ex.sets.map((s, i) => ({
        setNumber: s.setNumber || i + 1,
        reps: s.reps,
        weight: s.weight,
        distance: s.distance,
        time: s.time,
        plannedReps: s.plannedReps,
        plannedWeight: s.plannedWeight,
        plannedDistance: s.plannedDistance,
        plannedTime: s.plannedTime,
        blockId: s.blockId ?? ex.blockId ?? null,
        stepNumber: s.stepNumber ?? ex.stepNumber ?? null,
        intervalMinute: s.intervalMinute ?? ex.intervalMinute ?? null,
        cycleNumber: s.cycleNumber ?? ex.cycleNumber ?? null,
        stepRole: s.stepRole ?? ex.stepRole ?? null,
        groupId: s.groupId ?? ex.groupId ?? null,
      })),
    },
  };
}

export function processParsedExercises(parsed: ParsedExercise[], counterRef: MutableRefObject<number>) {
  const newBlocks: string[] = [];
  const newData: Record<string, StructuredExercise> = {};

  for (const ex of parsed) {
    const built = buildBlockFromParsed(ex);
    const sourceBlockId = ex.sets.find((s) => typeof s.blockId === "string" && s.blockId.length > 0)?.blockId;
    // Keep ids unique per parsed exercise row. A single parser source block
    // can contain multiple exercises; reusing one UI id would overwrite rows.
    const blockKey = sourceBlockId ? `${built.blockKey}::${sourceBlockId}` : built.blockKey;
    const blockId = makeBlockId(blockKey, counterRef);
    newBlocks.push(blockId);
    newData[blockId] = built.data;
  }

  return { newBlocks, newData };
}

function mergeKey(name: string, customLabel: string | null | undefined): string {
  const isLegacyEmom = name === "emom";
  const normalizedName = isLegacyEmom ? "custom" : name;
  const normalizedLabel = isLegacyEmom
    ? (customLabel || "EMOM")
    : customLabel;

  if (normalizedName === "custom") {
    return `custom|${(normalizedLabel ?? "").trim().toLowerCase()}`;
  }

  return `${normalizedName}|${normalizedLabel ?? ""}`;
}

/**
 * Auto-parse merge: user-edited blocks survive across re-parses, unedited
 * blocks from prior parses get replaced by the latest result. A parsed
 * block that matches an edited block (same exerciseName + customLabel)
 * is skipped — the user's version wins.
 *
 * This is the "live typing" path. Semantics:
 *   - EVERY edited block is preserved (including multiple blocks that
 *     share the same exerciseName + customLabel — the UI supports
 *     repeated "log as separate block" additions and we must not drop
 *     the duplicates on re-parse)
 *   - parsed blocks that match any preserved edit's key get skipped
 *     (the user's blocks represent that exercise already)
 *   - unedited existing blocks are dropped (the text is their source
 *     of truth, so the latest parse supersedes them)
 */
export function mergeParsedWithEdits(
  parsed: ParsedExercise[],
  counterRef: MutableRefObject<number>,
  existingBlocks: readonly string[],
  existingData: Readonly<Record<string, StructuredExercise>>,
) {
  const editedKeys = new Set<string>();
  const preservedIds: string[] = [];
  for (const id of existingBlocks) {
    const d = existingData[id];
    if (!d?.hasUserEdits) continue;
    preservedIds.push(id);
    editedKeys.add(mergeKey(d.exerciseName, d.customLabel));
  }

  const newBlocks: string[] = [...preservedIds];
  const newData: Record<string, StructuredExercise> = {};
  for (const id of preservedIds) newData[id] = existingData[id]!;

  for (const ex of parsed) {
    const built = buildBlockFromParsed(ex);
    const key = mergeKey(built.data.exerciseName, built.data.customLabel);
    if (editedKeys.has(key)) continue;
    const blockId = makeBlockId(built.blockKey, counterRef);
    newBlocks.push(blockId);
    newData[blockId] = built.data;
  }

  return { newBlocks, newData };
}

export function getParseSuccessDescription(parsed: ParsedExercise[]): string {
  // ⚡ Bolt Performance Optimization:
  // Combine multiple O(N) array filters into a single O(N) traversal
  // to avoid redundant object allocations.
  let lowConfCount = 0;
  let missingCount = 0;

  for (const e of parsed) {
    if (e.confidence != null && e.confidence < 80) lowConfCount++;
    if (e.missingFields && e.missingFields.length > 0) missingCount++;
  }

  let description = `Found ${parsed.length} exercise${parsed.length === 1 ? "" : "s"}.`;
  if (lowConfCount > 0) {
    description += ` ${lowConfCount} may need review (low confidence).`;
  }
  if (missingCount > 0) {
    description += ` ${missingCount} ha${missingCount === 1 ? "s" : "ve"} missing data — check the yellow warnings.`;
  }
  if (lowConfCount === 0 && missingCount === 0) {
    description += " Review the details below.";
  }
  return description;
}
