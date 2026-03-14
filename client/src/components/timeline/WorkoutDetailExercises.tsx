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
import { type TimelineEntry, type ExerciseSet, type ExerciseName } from "@shared/schema";
import { formatSpeed } from "@shared/unitConversion";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { ExerciseInput, type StructuredExercise } from "@/components/ExerciseInput";
import React, { useCallback, useState, useEffect } from "react";
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
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/VoiceButton";
import { VoiceFieldButton } from "@/components/VoiceFieldButton";
import { useToast } from "@/hooks/use-toast";


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


// --- View Sub-Components ---

const StructuredExerciseList = React.memo(function StructuredExerciseList({
  grouped,
  weightLabel,
  distanceUnit
}: {
  grouped: GroupedExercise[],
  weightLabel: string,
  distanceUnit: "km" | "miles"
}) {
  return (
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
  );
});

const WorkoutDetailsText = React.memo(function WorkoutDetailsText({ entry }: { entry: TimelineEntry }) {
  return (
    <>
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
    </>
  );
});

const StravaStats = React.memo(function StravaStats({
  entry,
  distanceUnit
}: {
  entry: TimelineEntry,
  distanceUnit: "km" | "miles"
}) {
  if (entry.source !== "strava" || (!entry.calories && !entry.avgWatts && !entry.sufferScore && !entry.avgCadence && !entry.avgSpeed)) {
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
});

export const WorkoutDetailView = React.memo(function WorkoutDetailView({ entry, grouped, hasStructuredData, weightLabel, distanceUnit }: WorkoutDetailViewProps) {
  return (
    <div className="space-y-3">
      {hasStructuredData ? (
        <StructuredExerciseList grouped={grouped} weightLabel={weightLabel} distanceUnit={distanceUnit} />
      ) : (
        <div>
          <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
        </div>
      )}
      <WorkoutDetailsText entry={entry} />
      <StravaStats entry={entry} distanceUnit={distanceUnit} />
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
  stopAllVoiceRef?: React.MutableRefObject<(() => void) | null>;
}


// --- Edit Sub-Components ---

const FocusInput = React.memo(function FocusInput({
  focus,
  onChange
}: {
  focus: string,
  onChange: (val: string) => void
}) {
  return (
    <div>
      <Label htmlFor="detail-focus">Focus</Label>
      <Input
        id="detail-focus"
        value={focus}
        onChange={(e) => onChange(e.target.value)}
        data-testid="input-detail-focus"
      />
    </div>
  );
});

const ModeToggle = React.memo(function ModeToggle({
  useTextMode,
  setUseTextMode,
  isVoiceSupported,
  onVoiceStart,
  onStopAllVoice,
}: {
  useTextMode: boolean;
  setUseTextMode: (mode: boolean) => void;
  isVoiceSupported: boolean;
  onVoiceStart: () => void;
  onStopAllVoice: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant={useTextMode ? "outline" : "default"}
        size="sm"
        onClick={() => {
          onStopAllVoice();
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
          onStopAllVoice();
          setUseTextMode(true);
        }}
        data-testid="button-mode-freetext"
      >
        <Type className="h-4 w-4 mr-1" />
        Free Text
      </Button>
      {isVoiceSupported && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onStopAllVoice();
            if (!useTextMode) setUseTextMode(true);
            onVoiceStart();
          }}
          data-testid="button-detail-mode-voice"
          title="Use voice input"
        >
          <Mic className="h-4 w-4 mr-1" />
          Voice
        </Button>
      )}
    </div>
  );
});

const TextModeEditor = React.memo(function TextModeEditor({
  mainWorkout,
  setMainWorkout,
  isListening,
  isSupported,
  interimTranscript,
  onToggleListening,
  onStopListening,
  onParseText,
  isParsing,
}: {
  mainWorkout: string;
  setMainWorkout: (val: string) => void;
  isListening: boolean;
  isSupported: boolean;
  interimTranscript: string;
  onToggleListening: () => void;
  onStopListening: () => void;
  onParseText: () => void;
  isParsing: boolean;
}) {
  return (
    <div className="space-y-3">
      {isListening && (
        <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2" data-testid="voice-detail-listening-indicator">
          <Mic className="h-4 w-4 animate-pulse" />
          <span>Listening... speak your workout</span>
        </div>
      )}
      <div className="relative">
        <Textarea
          id="detail-main"
          value={mainWorkout}
          onChange={(e) => setMainWorkout(e.target.value)}
          rows={3}
          data-testid="input-detail-main"
          placeholder={isListening ? "Listening... describe your workout" : "Describe your workout, e.g.:\n4x8 back squat at 70kg\n5km tempo run in 25 min"}
        />
        {isListening && interimTranscript && (
          <div className="px-3 py-1 text-xs text-muted-foreground italic truncate" data-testid="voice-detail-interim">
            {interimTranscript}
          </div>
        )}
        <VoiceButton
          isListening={isListening}
          isSupported={isSupported}
          onClick={onToggleListening}
          className="absolute top-2 right-2"
        />
      </div>
      <Button
        onClick={() => {
          if (isListening) onStopListening();
          onParseText();
        }}
        disabled={isParsing || !mainWorkout.trim()}
        variant="outline"
        className="w-full"
        data-testid="button-detail-parse-ai"
      >
        {isParsing ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        {isParsing ? "Parsing with AI..." : "Parse with AI"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {isSupported
          ? "Use the microphone to dictate your workout, or type it. AI will convert it into structured exercises."
          : "AI will convert your text into structured exercises you can review and edit."}
      </p>
    </div>
  );
});

const StructuredModeEditor = React.memo(function StructuredModeEditor({
  editExercises,
  editExerciseData,
  blockCounts,
  blockIndices,
  getSelectedExerciseNames,
  handleAddExercise,
  handleEditDragEnd,
  dialogSensors,
  updateBlock,
  handleRemoveBlock,
  weightUnit,
  distanceUnit,
}: {
  editExercises: string[];
  editExerciseData: Record<string, StructuredExercise>;
  blockCounts: Record<string, number>;
  blockIndices: Record<string, number>;
  getSelectedExerciseNames: () => ExerciseName[];
  handleAddExercise: (name: ExerciseName) => void;
  handleEditDragEnd: (event: DragEndEvent) => void;
  dialogSensors: SensorDescriptor<SensorOptions>[];
  updateBlock: (blockId: string, ex: StructuredExercise) => void;
  handleRemoveBlock: (blockId: string) => void;
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
}) {
  return (
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
              {editExercises.map((blockId) => {
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
  );
});

const AdditionalDetailsEditor = React.memo(function AdditionalDetailsEditor({
  accessory,
  notes,
  setAccessory,
  setNotes,
  onVoiceAccessory,
  onVoiceNotes,
  stopAccessoryRef,
  stopNotesRef,
}: {
  accessory: string;
  notes: string;
  setAccessory: (val: string) => void;
  setNotes: (val: string) => void;
  onVoiceAccessory: (text: string) => void;
  onVoiceNotes: (text: string) => void;
  stopAccessoryRef: React.MutableRefObject<(() => void) | null>;
  stopNotesRef: React.MutableRefObject<(() => void) | null>;
}) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="detail-accessory">Accessory/Engine Work</Label>
          <VoiceFieldButton onTranscript={onVoiceAccessory} onStopRef={stopAccessoryRef} data-testid="button-voice-detail-accessory" />
        </div>
        <Textarea
          id="detail-accessory"
          value={accessory}
          onChange={(e) => setAccessory(e.target.value)}
          rows={2}
          data-testid="input-detail-accessory"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="detail-notes">Notes</Label>
          <VoiceFieldButton onTranscript={onVoiceNotes} onStopRef={stopNotesRef} data-testid="button-voice-detail-notes" />
        </div>
        <Input
          id="detail-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-testid="input-detail-notes"
        />
      </div>
    </>
  );
});

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
  stopAllVoiceRef,
}: WorkoutDetailEditFormProps) {
  const editFormRef = React.useRef(editForm);
  editFormRef.current = editForm;

  const stopAccessoryRef = React.useRef<(() => void) | null>(null);
  const stopNotesRef = React.useRef<(() => void) | null>(null);

  const appendToField = useCallback((field: keyof EditFormState, text: string) => {
    const current = editFormRef.current;
    const val = current[field];
    const separator = val && !val.endsWith(" ") && !val.endsWith("\n") ? " " : "";
    setEditForm({
      ...current,
      [field]: val + separator + text,
    });
  }, [setEditForm]);

  const handleMainVoiceResult = useCallback((transcript: string) => {
    appendToField("mainWorkout", transcript);
  }, [appendToField]);

  const { toast } = useToast();

  const { blockCounts, blockIndices } = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const indices: Record<string, number> = {};
    const runningCounts: Record<string, number> = {};

    for (const blockId of editExercises) {
      const exData = editExerciseData[blockId];
      if (exData && exData.exerciseName) {
        const name = exData.exerciseName;
        counts[name] = (counts[name] || 0) + 1;
      }
    }

    for (const blockId of editExercises) {
      const exData = editExerciseData[blockId];
      if (exData && exData.exerciseName) {
        const name = exData.exerciseName;
        runningCounts[name] = (runningCounts[name] || 0) + 1;
        indices[blockId] = runningCounts[name];
      }
    }

    return { blockCounts: counts, blockIndices: indices };
  }, [editExercises, editExerciseData]);

  const handleVoiceError = useCallback((msg: string) => {
    toast({ title: "Voice Input", description: msg, variant: "destructive" });
  }, [toast]);

  const { isListening: isMainListening, isSupported, interimTranscript: mainInterim, startListening: startMainListening, stopListening: stopMainListening, toggleListening: toggleMainListening } = useVoiceInput({
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
    <div className="space-y-4">
      <FocusInput
        focus={editForm.focus}
        onChange={(val) => setEditForm({ ...editForm, focus: val })}
      />

      <ModeToggle
        useTextMode={useTextMode}
        setUseTextMode={setUseTextMode}
        isVoiceSupported={isSupported}
        onVoiceStart={startMainListening}
        onStopAllVoice={stopAllVoice}
      />

      {useTextMode ? (
        <TextModeEditor
          mainWorkout={editForm.mainWorkout}
          setMainWorkout={(val) => setEditForm({ ...editForm, mainWorkout: val })}
          isListening={isMainListening}
          isSupported={isSupported}
          interimTranscript={mainInterim}
          onToggleListening={toggleMainListening}
          onStopListening={stopMainListening}
          onParseText={onParseText}
          isParsing={parseMutation.isPending}
        />
      ) : (
        <StructuredModeEditor
          editExercises={editExercises}
          editExerciseData={editExerciseData}
          blockCounts={blockCounts}
          blockIndices={blockIndices}
          getSelectedExerciseNames={getSelectedExerciseNames}
          handleAddExercise={handleAddExercise}
          handleEditDragEnd={handleEditDragEnd}
          dialogSensors={dialogSensors}
          updateBlock={updateBlock}
          handleRemoveBlock={handleRemoveBlock}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
        />
      )}

      <AdditionalDetailsEditor
        accessory={editForm.accessory}
        notes={editForm.notes}
        setAccessory={(val) => setEditForm({ ...editForm, accessory: val })}
        setNotes={(val) => setEditForm({ ...editForm, notes: val })}
        onVoiceAccessory={(text) => appendToField("accessory", text)}
        onVoiceNotes={(text) => appendToField("notes", text)}
        stopAccessoryRef={stopAccessoryRef}
        stopNotesRef={stopNotesRef}
      />
    </div>
  );
});
