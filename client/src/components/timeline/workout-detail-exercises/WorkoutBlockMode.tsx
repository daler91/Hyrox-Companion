import React from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { SortableDialogBlock } from "./SortableDialogBlock";
import type { WorkoutBlockModeProps } from "./types";

export const WorkoutBlockMode = React.memo(function WorkoutBlockMode({
  editExercises,
  editExerciseData,
  dialogSensors,
  handleEditDragEnd,
  handleAddExercise,
  handleRemoveBlock,
  updateBlock,
  getSelectedExerciseNames,
  weightUnit,
  distanceUnit,
  blockCounts,
  blockIndices,
}: Readonly<WorkoutBlockModeProps>) {
  const renderedBlocks = React.useMemo(() => {
    return editExercises.map((blockId) => {
      const exData = editExerciseData[blockId];
      if (!exData) return null;
      const exName = exData.exerciseName;
      const blockCount = exName ? blockCounts[exName] || 1 : 1;
      const blockIndex = blockIndices[blockId] || 1;
      const showBlockNumber = blockCount > 1;
      return (
        <SortableDialogBlock
          key={blockId}
          blockId={blockId}
          exData={exData}
          blockLabel={showBlockNumber ? `#${blockIndex}` : undefined}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onChange={updateBlock}
          onRemove={handleRemoveBlock}
        />
      );
    });
  }, [
    editExercises,
    editExerciseData,
    blockCounts,
    blockIndices,
    weightUnit,
    distanceUnit,
    updateBlock,
    handleRemoveBlock,
  ]);

  return (
    <>
      <div>
        <p className="text-xs text-muted-foreground mb-2">
          Click an exercise to add it. You can add the same exercise multiple
          times.
        </p>
        <ExerciseSelector
          selectedExercises={getSelectedExerciseNames()}
          onToggle={() => {}}
          onAdd={handleAddExercise}
          allowDuplicates
        />
      </div>
      {editExercises.length > 0 && (
        <div className="space-y-3">
          <DndContext
            sensors={dialogSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleEditDragEnd}
          >
            <SortableContext
              items={editExercises}
              strategy={verticalListSortingStrategy}
            >
              {renderedBlocks}
            </SortableContext>
          </DndContext>
        </div>
      )}
      {editExercises.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          Add exercises using the button above
        </p>
      )}
    </>
  );
});
