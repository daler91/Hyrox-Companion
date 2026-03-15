import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { Save, ArrowLeft, Loader2, Dumbbell, Type, Sparkles, Mic, Gauge } from "lucide-react";
import { Link } from "wouter";
import { VoiceButton } from "@/components/VoiceButton";
import {
  DndContext,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useWorkoutEditor,
  getBlockExerciseName,
} from "@/hooks/useWorkoutEditor";
import { useWorkoutForm } from "@/hooks/useWorkoutForm";
import { SortableExerciseBlock } from "@/components/workout/SortableExerciseBlock";

export default function LogWorkout() {
  const { toast } = useToast();
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();

  const {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    setUseTextMode,
    sensors,
    handleDragEnd,
    addExercise,
    removeBlock,
    updateBlock,
    getSelectedExerciseNames,
    parseMutation,
  } = useWorkoutEditor();

  const {
    title,
    setTitle,
    date,
    setDate,
    freeText,
    setFreeText,
    notes,
    setNotes,
    rpe,
    setRpe,
    voiceInput,
    notesVoiceInput,
    saveMutation,
    handleSave,
  } = useWorkoutForm({
    useTextMode,
    exerciseBlocks,
    exerciseData,
    weightLabel,
    distanceUnit,
  });

  const {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  } = voiceInput;

  const {
    isListening: isNotesListening,
    isSupported: isNotesSupported,
    interimTranscript: notesInterim,
    toggleListening: toggleNotesListening,
  } = notesVoiceInput;

  const { blockCounts, blockIndices } = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const indices: Record<string, number> = {};
    const runningCounts: Record<string, number> = {};

    for (const blockId of exerciseBlocks) {
      const name = getBlockExerciseName(blockId);
      if (name) {
        counts[name] = (counts[name] || 0) + 1;
      }
    }

    for (const blockId of exerciseBlocks) {
      const name = getBlockExerciseName(blockId);
      if (name) {
        runningCounts[name] = (runningCounts[name] || 0) + 1;
        indices[blockId] = runningCounts[name];
      }
    }

    return { blockCounts: counts, blockIndices: indices };
  }, [exerciseBlocks]);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild data-testid="button-back" aria-label="Back to timeline">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Log Workout</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workout Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Workout Title</Label>
              <Input
                id="title"
                placeholder="e.g., Morning Hyrox Session"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-workout-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="input-workout-date"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" />
              RPE (Rate of Perceived Exertion)
            </Label>
            <div className="flex items-center gap-1.5" data-testid="input-rpe-selector">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRpe(rpe === value ? null : value)}
                  className={`h-8 w-8 rounded-md text-sm font-medium transition-colors ${
                    rpe === value
                      ? value <= 3
                        ? "bg-green-500 text-white"
                        : value <= 6
                        ? "bg-yellow-500 text-white"
                        : value <= 8
                        ? "bg-orange-500 text-white"
                        : "bg-red-500 text-white"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                  data-testid={`button-rpe-${value}`}
                >
                  {value}
                </button>
              ))}
              {rpe && (
                <span className="ml-2 text-xs text-muted-foreground" data-testid="text-rpe-label">
                  {rpe <= 3 ? "Easy" : rpe <= 6 ? "Moderate" : rpe <= 8 ? "Hard" : "Max Effort"}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          variant={useTextMode ? "outline" : "default"}
          size="sm"
          onClick={() => {
            if (isListening) stopListening();
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
            if (isListening) stopListening();
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
              if (!useTextMode) setUseTextMode(true);
              if (!isListening) startListening();
            }}
            data-testid="button-mode-voice"
            title="Use voice input"
          >
            <Mic className="h-4 w-4 mr-1" />
            Voice
          </Button>
        )}
      </div>

      {useTextMode ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Workout Description</CardTitle>
              <VoiceButton
                isListening={isListening}
                isSupported={isSupported}
                onClick={toggleListening}
                className=""
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isListening && (
              <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2" data-testid="voice-listening-indicator">
                <Mic className="h-4 w-4 animate-pulse" />
                <span>Listening... speak your workout</span>
              </div>
            )}
            <Textarea
              placeholder={isListening ? "Listening... describe your workout" : "Describe your workout, e.g.:\n4x8 back squat at 70kg\n3x10 bent over rows at 50kg\n5km tempo run in 25 min\n1000m skierg"}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              className="min-h-[120px]"
              data-testid="input-freetext"
            />
            {isListening && interimTranscript && (
              <div className="px-3 py-1 text-xs text-muted-foreground italic truncate" data-testid="voice-interim-freetext">
                {interimTranscript}
              </div>
            )}
            <Button
              onClick={() => {
                if (isListening) stopListening();
                if (!freeText.trim()) {
                  toast({ title: "No text", description: "Please describe your workout first.", variant: "destructive" });
                  return;
                }
                parseMutation.mutate(freeText);
              }}
              disabled={parseMutation.isPending || !freeText.trim()}
              variant="outline"
              className="w-full"
              data-testid="button-parse-ai"
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
                : "AI will convert your text into structured exercises you can review and edit before saving."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-lg">Select Exercises</CardTitle>
                <p className="text-xs text-muted-foreground">Click an exercise to add it. You can add the same exercise multiple times.</p>
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
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Notes</CardTitle>
            <VoiceButton
              isListening={isNotesListening}
              isSupported={isNotesSupported}
              onClick={toggleNotesListening}
              data-testid="button-voice-notes"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="How did the workout feel? Any observations..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[100px]"
            data-testid="input-workout-notes"
          />
          {isNotesListening && notesInterim && (
            <p className="text-sm text-muted-foreground mt-1 italic" data-testid="text-notes-interim">
              {notesInterim}
            </p>
          )}
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        disabled={saveMutation.isPending}
        className="w-full"
        size="lg"
        data-testid="button-save-workout"
      >
        {saveMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        {saveMutation.isPending ? "Saving..." : "Save Workout"}
      </Button>
    </div>
  );
}
