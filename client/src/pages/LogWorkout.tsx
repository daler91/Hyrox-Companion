import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { Save, ArrowLeft, Loader2, Dumbbell, Type, Sparkles, Mic } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/VoiceButton";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  exerciseToPayload,
  generateSummary,
} from "@/hooks/useWorkoutEditor";
import { SortableExerciseBlock } from "@/components/workout/SortableExerciseBlock";

export default function LogWorkout() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [freeText, setFreeText] = useState("");
  const [notes, setNotes] = useState("");

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

  const handleVoiceError = useCallback((msg: string) => {
    toast({ title: "Voice Input", description: msg, variant: "destructive" });
  }, [toast]);

  const handleVoiceResult = useCallback((transcript: string) => {
    setFreeText(prev => {
      const separator = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  const { isListening, isSupported, permissionDenied, interimTranscript, startListening, stopListening, toggleListening } = useVoiceInput({
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  const handleNotesVoiceResult = useCallback((transcript: string) => {
    setNotes(prev => {
      const separator = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  const { isListening: isNotesListening, isSupported: isNotesSupported, permissionDenied: isNotesDenied, interimTranscript: notesInterim, stopListening: stopNotesListening, toggleListening: toggleNotesListening } = useVoiceInput({
    onResult: handleNotesVoiceResult,
    onError: handleVoiceError,
  });

  const saveMutation = useMutation({
    mutationFn: async (workoutData: Record<string, any>) => {
      const response = await apiRequest("POST", "/api/workouts", workoutData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({
        title: "Workout logged",
        description: "Your workout has been saved successfully.",
      });
      navigate("/");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save workout. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (isListening) stopListening();
    if (isNotesListening) stopNotesListening();

    if (!title.trim()) {
      toast({
        title: "Missing title",
        description: "Please enter a workout title.",
        variant: "destructive",
      });
      return;
    }

    if (useTextMode) {
      if (!freeText.trim()) {
        toast({
          title: "Missing workout details",
          description: "Please describe your workout.",
          variant: "destructive",
        });
        return;
      }
      saveMutation.mutate({
        title,
        date,
        focus: title,
        mainWorkout: freeText,
        notes: notes || null,
      });
    } else {
      if (exerciseBlocks.length === 0) {
        toast({
          title: "No exercises",
          description: "Please add at least one exercise.",
          variant: "destructive",
        });
        return;
      }

      const exercises = exerciseBlocks.map(id => exerciseData[id]).filter(Boolean);
      const mainWorkout = generateSummary(exercises, weightLabel, distanceUnit);

      saveMutation.mutate({
        title,
        date,
        focus: title,
        mainWorkout,
        notes: notes || null,
        exercises: exercises.map(exerciseToPayload),
      });
    }
  };

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
        {(isSupported || permissionDenied) && (
          <Button
            variant="outline"
            size="sm"
            disabled={permissionDenied}
            onClick={() => {
              if (!useTextMode) setUseTextMode(true);
              if (!isListening) startListening();
            }}
            data-testid="button-mode-voice"
            title={permissionDenied ? "Microphone blocked — allow in browser settings" : "Use voice input"}
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
                permissionDenied={permissionDenied}
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
                  {exerciseBlocks.map((blockId, idx) => {
                    const exData = exerciseData[blockId];
                    if (!exData) return null;
                    const blockCount = exerciseBlocks.filter(b => getBlockExerciseName(b) === getBlockExerciseName(blockId)).length;
                    const blockIndex = exerciseBlocks.filter((b, i) => i <= idx && getBlockExerciseName(b) === getBlockExerciseName(blockId)).length;
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
              permissionDenied={isNotesDenied}
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
