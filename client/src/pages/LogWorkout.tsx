import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { ExerciseInput, createDefaultSet, type StructuredExercise } from "@/components/ExerciseInput";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { Save, ArrowLeft, Loader2, Dumbbell, Type, Sparkles, GripVertical } from "lucide-react";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";

function generateSummary(exercises: StructuredExercise[], weightUnit: string, distanceUnit: string): string {
  const distLabel = distanceUnit === "km" ? "m" : "ft";
  return exercises.map((ex) => {
    const def = EXERCISE_DEFINITIONS[ex.exerciseName];
    const name = ex.exerciseName === "custom" && ex.customLabel ? ex.customLabel : def?.label || ex.exerciseName;
    const sets = ex.sets || [];
    if (sets.length === 0) return `${name}: completed`;
    const firstSet = sets[0];
    const allSame = sets.every(s => s.reps === firstSet.reps && s.weight === firstSet.weight);
    const parts: string[] = [];
    if (allSame && sets.length > 1 && firstSet.reps) {
      parts.push(`${sets.length}x${firstSet.reps}`);
    } else if (firstSet.reps) {
      parts.push(`${sets.length > 1 ? sets.length + " sets, " : ""}${firstSet.reps} reps`);
    } else if (sets.length > 1) {
      parts.push(`${sets.length} sets`);
    }
    if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightUnit}`);
    if (firstSet.distance) parts.push(`${firstSet.distance}${distLabel}`);
    if (firstSet.time) parts.push(`${firstSet.time}min`);
    return `${name}: ${parts.join(", ") || "completed"}`;
  }).join("; ");
}

function exerciseToPayload(ex: StructuredExercise) {
  return {
    exerciseName: ex.exerciseName,
    customLabel: ex.customLabel,
    category: ex.category,
    confidence: ex.confidence,
    sets: (ex.sets || []).map(s => ({
      setNumber: s.setNumber,
      reps: s.reps,
      weight: s.weight,
      distance: s.distance,
      time: s.time,
      notes: s.notes,
    })),
  };
}

export default function LogWorkout() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [useTextMode, setUseTextMode] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [exerciseBlocks, setExerciseBlocks] = useState<string[]>([]);
  const [exerciseData, setExerciseData] = useState<Record<string, StructuredExercise>>({});
  const [notes, setNotes] = useState("");
  const blockCounterRef = useRef(0);

  const makeBlockId = (name: string) => {
    blockCounterRef.current += 1;
    return `${name}__${blockCounterRef.current}`;
  };

  const getBlockExerciseName = (blockId: string): ExerciseName => {
    const name = blockId.split("__")[0];
    if (name.startsWith("custom:")) return "custom" as ExerciseName;
    return name as ExerciseName;
  };

  const getSelectedExerciseNames = (): ExerciseName[] => {
    return exerciseBlocks.map(getBlockExerciseName);
  };

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/parse-exercises", { text });
      return response.json();
    },
    onSuccess: (parsed: Array<{ exerciseName: string; category: string; customLabel?: string; confidence?: number; sets: Array<{ setNumber: number; reps?: number; weight?: number; distance?: number; time?: number }> }>) => {
      if (parsed.length === 0) {
        toast({
          title: "No exercises found",
          description: "AI couldn't identify any exercises in your text. Try being more specific, e.g. '4x8 back squat at 70kg'.",
          variant: "destructive",
        });
        return;
      }

      const newBlocks: string[] = [];
      const newData: Record<string, StructuredExercise> = {};

      for (const ex of parsed) {
        const rawName = ex.exerciseName as ExerciseName;
        const isKnown = rawName in EXERCISE_DEFINITIONS;
        const exName = isKnown ? rawName : ("custom" as ExerciseName);
        const blockId = makeBlockId(exName === "custom" ? `custom:${ex.customLabel || ex.exerciseName}` : exName);

        newBlocks.push(blockId);
        newData[blockId] = {
          exerciseName: exName,
          category: isKnown ? EXERCISE_DEFINITIONS[rawName].category : ex.category,
          customLabel: isKnown ? undefined : (ex.customLabel || ex.exerciseName),
          confidence: ex.confidence,
          sets: ex.sets.map((s, i) => ({
            setNumber: s.setNumber || i + 1,
            reps: s.reps,
            weight: s.weight,
            distance: s.distance,
            time: s.time,
          })),
        };
      }

      setExerciseBlocks(newBlocks);
      setExerciseData(newData);
      setUseTextMode(false);

      const lowConfCount = parsed.filter(e => e.confidence != null && e.confidence < 80).length;
      toast({
        title: "Exercises parsed",
        description: lowConfCount > 0
          ? `Found ${parsed.length} exercise${parsed.length !== 1 ? "s" : ""}. ${lowConfCount} may need review (low confidence).`
          : `Found ${parsed.length} exercise${parsed.length !== 1 ? "s" : ""}. Review the details below.`,
      });
    },
    onError: () => {
      toast({
        title: "Parsing failed",
        description: "AI couldn't parse your workout text. Please try again or enter exercises manually.",
        variant: "destructive",
      });
    },
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

  const handleAddExercise = (name: ExerciseName) => {
    const blockId = makeBlockId(name);
    const def = EXERCISE_DEFINITIONS[name];
    setExerciseBlocks(prev => [...prev, blockId]);
    setExerciseData(prev => ({
      ...prev,
      [blockId]: {
        exerciseName: name,
        category: def.category,
        sets: [createDefaultSet(1)],
      },
    }));
  };

  const handleRemoveBlock = (blockId: string) => {
    setExerciseBlocks(prev => prev.filter(b => b !== blockId));
    setExerciseData(prev => {
      const newData = { ...prev };
      delete newData[blockId];
      return newData;
    });
  };

  const handleExerciseChange = (blockId: string, exercise: StructuredExercise) => {
    setExerciseData(prev => ({
      ...prev,
      [blockId]: exercise,
    }));
  };

  const handleSave = () => {
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
        <Button variant="ghost" size="icon" asChild data-testid="button-back">
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
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Workout Description</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={"Describe your workout, e.g.:\n4x8 back squat at 70kg\n3x10 bent over rows at 50kg\n5km tempo run in 25 min\n1000m skierg"}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              className="min-h-[120px]"
              data-testid="input-freetext"
            />
            <Button
              onClick={() => {
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
              AI will convert your text into structured exercises you can review and edit before saving.
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
                onAdd={handleAddExercise}
                allowDuplicates
              />
            </CardContent>
          </Card>

          {exerciseBlocks.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Exercise Details</h2>
              <p className="text-xs text-muted-foreground">Exercises are ordered as you added them. Remove and re-add to reorder.</p>
              {exerciseBlocks.map((blockId, idx) => {
                const exData = exerciseData[blockId];
                if (!exData) return null;
                const blockCount = exerciseBlocks.filter(b => getBlockExerciseName(b) === exData.exerciseName).length;
                const blockIndex = exerciseBlocks.filter((b, i) => i <= idx && getBlockExerciseName(b) === exData.exerciseName).length;
                const showBlockNumber = blockCount > 1;
                return (
                  <ExerciseInput
                    key={blockId}
                    exercise={exData}
                    onChange={(ex) => handleExerciseChange(blockId, ex)}
                    onRemove={() => handleRemoveBlock(blockId)}
                    weightUnit={weightUnit}
                    distanceUnit={distanceUnit}
                    blockLabel={showBlockNumber ? `#${blockIndex}` : undefined}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="How did the workout feel? Any observations..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[100px]"
            data-testid="input-workout-notes"
          />
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
