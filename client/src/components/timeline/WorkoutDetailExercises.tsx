import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Flame,
  Zap,
  Activity,
  TrendingUp,
  Type,
  Dumbbell,
  Sparkles,
  GripVertical,
} from "lucide-react";
import { type TimelineEntry, type ExerciseSet, type ExerciseName } from "@shared/schema";
import { formatSpeed } from "@shared/unitConversion";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { ExerciseInput, type StructuredExercise } from "@/components/ExerciseInput";
import React from "react";
import { categoryChipColors, getExerciseLabel, groupExerciseSets, formatExerciseSummary, exerciseSetsToStructured, type GroupedExercise } from "@/lib/exerciseUtils";
import {
  DndContext,
  closestCenter,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DragEndEvent } from "@dnd-kit/core";
import type { UseMutationResult } from "@tanstack/react-query";


interface SortableDialogBlockProps {
  blockId: string;
  exData: StructuredExercise;
  blockLabel?: string;
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  onChange: (blockId: string, ex: StructuredExercise) => void;
  onRemove: (blockId: string) => void;
}

const SortableDialogBlock = React.memo(function SortableDialogBlock({ blockId, exData, blockLabel, weightUnit, distanceUnit, onChange, onRemove }: SortableDialogBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="absolute left-0 top-3 z-10 cursor-grab active:cursor-grabbing touch-none p-1" {...attributes} {...listeners} data-testid={`drag-handle-dialog-${blockId}`}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="pl-6">
        <ExerciseInput
          exercise={exData}
          onChange={(ex) => onChange(blockId, ex)}
          onRemove={() => onRemove(blockId)}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          blockLabel={blockLabel}
        />
      </div>
    </div>
  );
});

interface WorkoutDetailViewProps {
  entry: TimelineEntry;
  grouped: GroupedExercise[];
  hasStructuredData: boolean;
  weightLabel: string;
  distanceUnit: "km" | "miles";
}

export const WorkoutDetailView = React.memo(function WorkoutDetailView({ entry, grouped, hasStructuredData, weightLabel, distanceUnit }: WorkoutDetailViewProps) {
  return (
    <div className="space-y-3">
      {hasStructuredData ? (
        <div className="flex flex-wrap gap-1.5" data-testid="detail-exercise-chips">
          {grouped.map((group, idx) => (
            <Badge
              key={`${group.exerciseName}-${idx}`}
              variant="secondary"
              className={`text-xs font-normal ${categoryChipColors[group.category] || ""}`}
            >
              {formatExerciseSummary(group, weightLabel, distanceUnit)}
            </Badge>
          ))}
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
        </div>
      )}
      {entry.accessory && (
        <div>
          <p className="text-xs font-medium text-muted-foreground/70 mb-1">Accessory</p>
          <p className="text-sm text-muted-foreground/70">{entry.accessory}</p>
        </div>
      )}
      {entry.notes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground/70 mb-1">Notes</p>
          <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
        </div>
      )}
      {entry.duration && entry.source !== "strava" && (
        <p className="text-xs text-muted-foreground">
          Duration: {entry.duration} min
          {entry.rpe && ` | RPE: ${entry.rpe}`}
        </p>
      )}
      {entry.source === "strava" && (entry.calories || entry.avgWatts || entry.sufferScore || entry.avgCadence || entry.avgSpeed) && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-border/50">
          {entry.calories && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Flame className="h-3 w-3 text-orange-500" />
              <span>{entry.calories} cal</span>
            </div>
          )}
          {entry.avgWatts && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Zap className="h-3 w-3 text-yellow-500" />
              <span>{entry.avgWatts}W</span>
            </div>
          )}
          {entry.avgCadence && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="h-3 w-3 text-blue-500" />
              <span>{Math.round(entry.avgCadence)} spm</span>
            </div>
          )}
          {entry.avgSpeed && entry.avgSpeed > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span>{formatSpeed(entry.avgSpeed, distanceUnit)}</span>
            </div>
          )}
          {entry.sufferScore && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-purple-500" />
              <span>Effort: {entry.sufferScore}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface EditFormState {
  focus: string;
  mainWorkout: string;
  accessory: string;
  notes: string;
}

interface WorkoutDetailEditFormProps {
  editForm: EditFormState;
  setEditForm: (form: EditFormState) => void;
  useTextMode: boolean;
  setUseTextMode: (mode: boolean) => void;
  editExercises: string[];
  editExerciseData: Record<string, StructuredExercise>;
  dialogSensors: SensorDescriptor<SensorOptions>[];
  handleEditDragEnd: (event: DragEndEvent) => void;
  handleAddExercise: (name: ExerciseName) => void;
  handleRemoveBlock: (blockId: string) => void;
  updateBlock: (blockId: string, ex: StructuredExercise) => void;
  getSelectedExerciseNames: () => ExerciseName[];
  parseMutation: UseMutationResult<any, Error, string, unknown>;
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  onParseText: () => void;
}

export const WorkoutDetailEditForm = React.memo(function WorkoutDetailEditForm({
  editForm,
  setEditForm,
  useTextMode,
  setUseTextMode,
  editExercises,
  editExerciseData,
  dialogSensors,
  handleEditDragEnd,
  handleAddExercise,
  handleRemoveBlock,
  updateBlock,
  getSelectedExerciseNames,
  parseMutation,
  weightUnit,
  distanceUnit,
  onParseText,
}: WorkoutDetailEditFormProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="detail-focus">Focus</Label>
        <Input
          id="detail-focus"
          value={editForm.focus}
          onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
          data-testid="input-detail-focus"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={useTextMode ? "outline" : "default"}
          size="sm"
          onClick={() => setUseTextMode(false)}
          data-testid="button-mode-exercises"
        >
          <Dumbbell className="h-4 w-4 mr-1" />
          Exercises
        </Button>
        <Button
          variant={useTextMode ? "default" : "outline"}
          size="sm"
          onClick={() => setUseTextMode(true)}
          data-testid="button-mode-freetext"
        >
          <Type className="h-4 w-4 mr-1" />
          Free Text
        </Button>
      </div>

      {useTextMode ? (
        <div className="space-y-3">
          <Textarea
            id="detail-main"
            value={editForm.mainWorkout}
            onChange={(e) => setEditForm({ ...editForm, mainWorkout: e.target.value })}
            rows={3}
            data-testid="input-detail-main"
            placeholder={"Describe your workout, e.g.:\n4x8 back squat at 70kg\n5km tempo run in 25 min"}
          />
          <Button
            onClick={onParseText}
            disabled={parseMutation.isPending || !editForm.mainWorkout.trim()}
            variant="outline"
            className="w-full"
            data-testid="button-detail-parse-ai"
          >
            {parseMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            {parseMutation.isPending ? "Parsing with AI..." : "Parse with AI"}
          </Button>
          <p className="text-xs text-muted-foreground">
            AI will convert your text into structured exercises you can review and edit.
          </p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Click an exercise to add it. You can add the same exercise multiple times.</p>
            <ExerciseSelector
              selectedExercises={getSelectedExerciseNames()}
              onToggle={() => {}}
              onAdd={handleAddExercise}
              allowDuplicates
            />
          </div>
          {editExercises.length > 0 && (
            <div className="space-y-3">
              <DndContext sensors={dialogSensors} collisionDetection={closestCenter} onDragEnd={handleEditDragEnd}>
                <SortableContext items={editExercises} strategy={verticalListSortingStrategy}>
                  {editExercises.map((blockId, idx) => {
                    const exData = editExerciseData[blockId];
                    if (!exData) return null;
                    const exName = exData.exerciseName;
                    const blockCount = editExercises.filter(b => editExerciseData[b]?.exerciseName === exName).length;
                    const blockIndex = editExercises.filter((b, i) => i <= idx && editExerciseData[b]?.exerciseName === exName).length;
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
                  })}
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
      )}

      <div>
        <Label htmlFor="detail-accessory">Accessory/Engine Work</Label>
        <Textarea
          id="detail-accessory"
          value={editForm.accessory}
          onChange={(e) => setEditForm({ ...editForm, accessory: e.target.value })}
          rows={2}
          data-testid="input-detail-accessory"
        />
      </div>
      <div>
        <Label htmlFor="detail-notes">Notes</Label>
        <Input
          id="detail-notes"
          value={editForm.notes}
          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
          data-testid="input-detail-notes"
        />
      </div>
    </div>
  );
});
