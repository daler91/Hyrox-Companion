import { type ParsedExercise, type TimelineEntry, type ExerciseName } from "@shared/schema";
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
  Mic,
} from "lucide-react";
import { formatSpeed } from "@shared/unitConversion";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import {
  ExerciseInput,
  type StructuredExercise,
} from "@/components/ExerciseInput";
import React, { useCallback, useState, useEffect } from "react";
import {
  categoryChipColors,
  formatExerciseSummary,
  type GroupedExercise,
} from "@/lib/exerciseUtils";
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

import { useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/VoiceButton";
import { VoiceFieldButton } from "@/components/VoiceFieldButton";
import { RpeSelector } from "@/components/RpeSelector";
import { useToast } from "@/hooks/use-toast";

interface SortableDialogBlockProps {
  readonly blockId: string;
  readonly exData: StructuredExercise;
  readonly blockLabel?: string;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly onChange: (blockId: string, ex: StructuredExercise) => void;
  readonly onRemove: (blockId: string) => void;
}

const SortableDialogBlock = React.memo(function SortableDialogBlock({
  blockId,
  exData,
  blockLabel,
  weightUnit,
  distanceUnit,
  onChange,
  onRemove,
}: SortableDialogBlockProps) {
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
      <div
        className="absolute left-0 top-3 z-10 cursor-grab active:cursor-grabbing touch-none p-1"
        {...attributes}
        {...listeners}
        data-testid={`drag-handle-dialog-${blockId}`}
      >
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
  readonly entry: TimelineEntry;
  readonly grouped: GroupedExercise[];
  readonly hasStructuredData: boolean;
  readonly weightLabel: string;
  readonly distanceUnit: "km" | "miles";
}

interface WorkoutDetailStravaMetricsProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: "km" | "miles";
}

const WorkoutDetailStravaMetrics = React.memo(
  function WorkoutDetailStravaMetrics({
    entry,
    distanceUnit,
  }: WorkoutDetailStravaMetricsProps) {
    if (
      entry.source !== "strava" ||
      (!entry.calories &&
        !entry.avgWatts &&
        !entry.sufferScore &&
        !entry.avgCadence &&
        !entry.avgSpeed)
    ) {
      return null;
    }

    return (
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
    );
  },
);

export const WorkoutDetailView = React.memo(function WorkoutDetailView({
  entry,
  grouped,
  hasStructuredData,
  weightLabel,
  distanceUnit,
}: WorkoutDetailViewProps) {
  return (
    <div className="space-y-3">
      {hasStructuredData ? (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="detail-exercise-chips"
        >
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
          <p className="text-xs font-medium text-muted-foreground/70 mb-1">
            Accessory
          </p>
          <p className="text-sm text-muted-foreground/70">{entry.accessory}</p>
        </div>
      )}
      {entry.notes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground/70 mb-1">
            Notes
          </p>
          <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
        </div>
      )}
      {entry.duration && entry.source !== "strava" && (
        <p className="text-xs text-muted-foreground">
          Duration: {entry.duration} min
          {entry.rpe && ` | RPE: ${entry.rpe}`}
        </p>
      )}
      <WorkoutDetailStravaMetrics entry={entry} distanceUnit={distanceUnit} />
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
  readonly editForm: EditFormState;
  readonly setEditForm: (form: EditFormState) => void;
  readonly useTextMode: boolean;
  readonly setUseTextMode: (mode: boolean) => void;
  readonly editExercises: string[];
  readonly editExerciseData: Record<string, StructuredExercise>;
  readonly dialogSensors: SensorDescriptor<SensorOptions>[];
  readonly handleEditDragEnd: (event: DragEndEvent) => void;
  readonly handleAddExercise: (name: ExerciseName) => void;
  readonly handleRemoveBlock: (blockId: string) => void;
  readonly updateBlock: (blockId: string, ex: StructuredExercise) => void;
  readonly getSelectedExerciseNames: () => ExerciseName[];
  readonly parseMutation: UseMutationResult<ParsedExercise[], Error, string, unknown>;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly onParseText: () => void;
  readonly stopAllVoiceRef?: React.MutableRefObject<(() => void) | null>;
  readonly editRpe?: number | null;
  readonly setEditRpe?: (val: number | null) => void;
  readonly source?: string;
}

interface WorkoutTextModeProps {
  readonly editForm: EditFormState;
  readonly setEditForm: (form: EditFormState) => void;
  readonly isMainListening: boolean;
  readonly isSupported: boolean;
  readonly mainInterim: string;
  readonly startMainListening: () => void;
  readonly stopMainListening: () => void;
  readonly toggleMainListening: () => void;
  readonly onParseText: () => void;
  readonly parseMutation: UseMutationResult<ParsedExercise[], Error, string, unknown>;
}

const WorkoutTextMode = React.memo(function WorkoutTextMode({
  editForm,
  setEditForm,
  isMainListening,
  isSupported,
  mainInterim,
  startMainListening,
  stopMainListening,
  toggleMainListening,
  onParseText,
  parseMutation,
}: WorkoutTextModeProps) {
  return (
    <div className="space-y-3">
      {isMainListening && (
        <div
          className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
          data-testid="voice-detail-listening-indicator"
        >
          <Mic className="h-4 w-4 animate-pulse" />
          <span>Listening... speak your workout</span>
        </div>
      )}
      <div className="relative">
        <Textarea
          id="detail-main"
          value={editForm.mainWorkout}
          onChange={(e) =>
            setEditForm({ ...editForm, mainWorkout: e.target.value })
          }
          rows={3}
          data-testid="input-detail-main"
          placeholder={
            isMainListening
              ? "Listening... describe your workout"
              : "Describe your workout, e.g.:\n4x8 back squat at 70kg\n5km tempo run in 25 min"
          }
        />
        {isMainListening && mainInterim && (
          <div
            className="px-3 py-1 text-xs text-muted-foreground italic truncate"
            data-testid="voice-detail-interim"
          >
            {mainInterim}
          </div>
        )}
        <VoiceButton
          isListening={isMainListening}
          isSupported={isSupported}
          onClick={toggleMainListening}
          className="absolute top-2 right-2"
        />
      </div>
      <Button
        onClick={() => {
          if (isMainListening) stopMainListening();
          onParseText();
        }}
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
        {isSupported
          ? "Use the microphone to dictate your workout, or type it. AI will convert it into structured exercises."
          : "AI will convert your text into structured exercises you can review and edit."}
      </p>
    </div>
  );
});

interface WorkoutBlockModeProps {
  readonly editExercises: string[];
  readonly editExerciseData: Record<string, StructuredExercise>;
  readonly dialogSensors: SensorDescriptor<SensorOptions>[];
  readonly handleEditDragEnd: (event: DragEndEvent) => void;
  readonly handleAddExercise: (name: ExerciseName) => void;
  readonly handleRemoveBlock: (blockId: string) => void;
  readonly updateBlock: (blockId: string, ex: StructuredExercise) => void;
  readonly getSelectedExerciseNames: () => ExerciseName[];
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly blockCounts: Record<string, number>;
  readonly blockIndices: Record<string, number>;
}

const WorkoutBlockMode = React.memo(function WorkoutBlockMode({
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
}: WorkoutBlockModeProps) {
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

interface WorkoutAccessoryNotesProps {
  readonly editForm: EditFormState;
  readonly setEditForm: (form: EditFormState) => void;
  readonly appendToField: (field: keyof EditFormState, text: string) => void;
  readonly stopAccessoryRef: React.MutableRefObject<(() => void) | null>;
  readonly stopNotesRef: React.MutableRefObject<(() => void) | null>;
}

const WorkoutAccessoryNotes = React.memo(function WorkoutAccessoryNotes({
  editForm,
  setEditForm,
  appendToField,
  stopAccessoryRef,
  stopNotesRef,
}: WorkoutAccessoryNotesProps) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="detail-accessory">Accessory/Engine Work</Label>
          <VoiceFieldButton
            onTranscript={(text) => appendToField("accessory", text)}
            onStopRef={stopAccessoryRef}
            data-testid="button-voice-detail-accessory"
          />
        </div>
        <Textarea
          id="detail-accessory"
          value={editForm.accessory}
          onChange={(e) =>
            setEditForm({ ...editForm, accessory: e.target.value })
          }
          rows={2}
          data-testid="input-detail-accessory"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="detail-notes">Notes</Label>
          <VoiceFieldButton
            onTranscript={(text) => appendToField("notes", text)}
            onStopRef={stopNotesRef}
            data-testid="button-voice-detail-notes"
          />
        </div>
        <Input
          id="detail-notes"
          value={editForm.notes}
          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
          data-testid="input-detail-notes"
          placeholder="Add any observations or notes..."
        />
      </div>
    </>
  );
});

export const WorkoutDetailEditForm = React.memo(function WorkoutDetailEditForm({
  editRpe = null,
  setEditRpe = () => {},
  source = "manual",
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
  stopAllVoiceRef,
}: WorkoutDetailEditFormProps) {
  const editFormRef = React.useRef(editForm);
  editFormRef.current = editForm;

  const stopAccessoryRef = React.useRef<(() => void) | null>(null);
  const stopNotesRef = React.useRef<(() => void) | null>(null);

  const appendToField = useCallback(
    (field: keyof EditFormState, text: string) => {
      const current = editFormRef.current;
      const val = current[field];
      const separator =
        val && !val.endsWith(" ") && !val.endsWith("\n") ? " " : "";
      setEditForm({
        ...current,
        [field]: val + separator + text,
      });
    },
    [setEditForm],
  );

  const handleMainVoiceResult = useCallback(
    (transcript: string) => {
      appendToField("mainWorkout", transcript);
    },
    [appendToField],
  );

  const { toast } = useToast();

  const { blockCounts, blockIndices } = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const indices: Record<string, number> = {};
    const runningCounts: Record<string, number> = {};

    for (const blockId of editExercises) {
      const exData = editExerciseData[blockId];
      if (exData?.exerciseName) {
        const name = exData.exerciseName;
        counts[name] = (counts[name] || 0) + 1;
      }
    }

    for (const blockId of editExercises) {
      const exData = editExerciseData[blockId];
      if (exData?.exerciseName) {
        const name = exData.exerciseName;
        runningCounts[name] = (runningCounts[name] || 0) + 1;
        indices[blockId] = runningCounts[name];
      }
    }

    return { blockCounts: counts, blockIndices: indices };
  }, [editExercises, editExerciseData]);

  const handleVoiceError = useCallback(
    (msg: string) => {
      toast({ title: "Voice Input", description: msg, variant: "destructive" });
    },
    [toast],
  );

  const {
    isListening: isMainListening,
    isSupported,
    interimTranscript: mainInterim,
    startListening: startMainListening,
    stopListening: stopMainListening,
    toggleListening: toggleMainListening,
  } = useVoiceInput({
    onResult: handleMainVoiceResult,
    onError: handleVoiceError,
  });

  const stopAllVoice = useCallback(() => {
    stopMainListening();
    stopAccessoryRef.current?.();
    stopNotesRef.current?.();
  }, [stopMainListening]);

  if (stopAllVoiceRef) {
    stopAllVoiceRef.current = stopAllVoice;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
      {/* Left Column */}
      <div className="md:col-span-5 lg:col-span-4 space-y-4">
        <div>
          <Label htmlFor="detail-focus">Focus</Label>
          <Input
            id="detail-focus"
            value={editForm.focus}
            onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
            data-testid="input-detail-focus"
            placeholder="e.g., Upper Body Strength, Active Recovery..."
          />
        </div>

        <WorkoutAccessoryNotes
          editForm={editForm}
          setEditForm={setEditForm}
          appendToField={appendToField}
          stopAccessoryRef={stopAccessoryRef}
          stopNotesRef={stopNotesRef}
        />

        {source !== "strava" && (
          <RpeSelector value={editRpe} onChange={setEditRpe} compact />
        )}
      </div>

      {/* Right Column */}
      <div className="md:col-span-7 lg:col-span-8 space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant={useTextMode ? "outline" : "default"}
            size="sm"
            onClick={() => {
              stopAllVoice();
              setUseTextMode(false);
            }}
            data-testid="button-mode-exercises"
          >
            <Dumbbell className="h-4 w-4 mr-1" />
            Exercises
          </Button>
          <Button
            variant={useTextMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              stopAllVoice();
              setUseTextMode(true);
            }}
            data-testid="button-mode-freetext"
          >
            <Type className="h-4 w-4 mr-1" />
            Free Text
          </Button>
          {isSupported && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                stopAllVoice();
                if (!useTextMode) setUseTextMode(true);
                startMainListening();
              }}
              data-testid="button-detail-mode-voice"
              title="Use voice input"
            >
              <Mic className="h-4 w-4 mr-1" />
              Voice
            </Button>
          )}
        </div>

        {useTextMode ? (
          <WorkoutTextMode
            editForm={editForm}
            setEditForm={setEditForm}
            isMainListening={isMainListening}
            isSupported={isSupported}
            mainInterim={mainInterim}
            startMainListening={startMainListening}
            stopMainListening={stopMainListening}
            toggleMainListening={toggleMainListening}
            onParseText={onParseText}
            parseMutation={parseMutation}
          />
        ) : (
          <WorkoutBlockMode
            editExercises={editExercises}
            editExerciseData={editExerciseData}
            dialogSensors={dialogSensors}
            handleEditDragEnd={handleEditDragEnd}
            handleAddExercise={handleAddExercise}
            handleRemoveBlock={handleRemoveBlock}
            updateBlock={updateBlock}
            getSelectedExerciseNames={getSelectedExerciseNames}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            blockCounts={blockCounts}
            blockIndices={blockIndices}
          />
        )}
      </div>
    </div>
  );
});
