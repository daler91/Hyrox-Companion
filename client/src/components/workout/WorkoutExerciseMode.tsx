import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { SortableExerciseBlock } from "@/components/workout/SortableExerciseBlock";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { StructuredExercise } from "@/components/ExerciseInput";
import type { ExerciseName } from "@shared/schema";

interface WorkoutExerciseModeProps {
  exerciseBlocks: string[];
  exerciseData: Record<string, StructuredExercise>;
  getSelectedExerciseNames: () => ExerciseName[];
  addExercise: (exercise: ExerciseName) => void;
  updateBlock: (blockId: string, exData: StructuredExercise) => void;
  removeBlock: (blockId: string) => void;
  sensors: SensorDescriptor<SensorOptions>[];
  handleDragEnd: (event: DragEndEvent) => void;
  blockCounts: Record<string, number>;
  blockIndices: Record<string, number>;
  getBlockExerciseName: (blockId: string) => string | undefined;
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
}

export const WorkoutExerciseMode = ({
  exerciseBlocks,
  exerciseData,
  getSelectedExerciseNames,
  addExercise,
  updateBlock,
  removeBlock,
  sensors,
  handleDragEnd,
  blockCounts,
  blockIndices,
  getBlockExerciseName,
  weightUnit,
  distanceUnit,
}: Readonly<WorkoutExerciseModeProps>) => {
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Select Exercises</CardTitle>
            <p className="text-xs text-muted-foreground">
              Click an exercise to add it. You can add the same exercise multiple times.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <ExerciseSelector
            selectedExercises={getSelectedExerciseNames()}
            onToggle={() => {}}
            onAdd={addExercise}
            allowDuplicates
          />
        </CardContent>
      </Card>

      {exerciseBlocks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Exercise Details</h2>
          <p className="text-xs text-muted-foreground">Drag the handle to reorder exercises.</p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={exerciseBlocks} strategy={verticalListSortingStrategy}>
              {exerciseBlocks.map((blockId) => {
                const exData = exerciseData[blockId];
                if (!exData) return null;
                const name = getBlockExerciseName(blockId);
                const blockCount = name ? blockCounts[name] || 1 : 1;
                const blockIndex = name ? blockIndices[blockId] || 1 : 1;
                const showBlockNumber = blockCount > 1;
                return (
                  <SortableExerciseBlock
                    key={blockId}
                    blockId={blockId}
                    exData={exData}
                    blockLabel={showBlockNumber ? `#${blockIndex}` : undefined}
                    weightUnit={weightUnit}
                    distanceUnit={distanceUnit}
                    onChange={updateBlock}
                    onRemove={removeBlock}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </>
  );
};
