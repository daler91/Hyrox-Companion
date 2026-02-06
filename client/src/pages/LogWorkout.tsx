import { useState } from "react";
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
import { Save, ArrowLeft, Loader2, Dumbbell, Type } from "lucide-react";
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
  const [selectedExercises, setSelectedExercises] = useState<ExerciseName[]>([]);
  const [exerciseData, setExerciseData] = useState<Record<string, StructuredExercise>>({});
  const [notes, setNotes] = useState("");

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

  const handleToggleExercise = (name: ExerciseName) => {
    setSelectedExercises((prev) => {
      if (prev.includes(name)) {
        const newData = { ...exerciseData };
        delete newData[name];
        setExerciseData(newData);
        return prev.filter((n) => n !== name);
      } else {
        const def = EXERCISE_DEFINITIONS[name];
        setExerciseData((prevData) => ({
          ...prevData,
          [name]: {
            exerciseName: name,
            category: def.category,
            sets: [createDefaultSet(1)],
          },
        }));
        return [...prev, name];
      }
    });
  };

  const handleExerciseChange = (exercise: StructuredExercise) => {
    setExerciseData((prev) => ({
      ...prev,
      [exercise.exerciseName]: exercise,
    }));
  };

  const handleRemoveExercise = (name: ExerciseName) => {
    setSelectedExercises((prev) => prev.filter((n) => n !== name));
    setExerciseData((prev) => {
      const newData = { ...prev };
      delete newData[name];
      return newData;
    });
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
      if (selectedExercises.length === 0) {
        toast({
          title: "No exercises",
          description: "Please add at least one exercise.",
          variant: "destructive",
        });
        return;
      }

      const exercises = selectedExercises.map((name) => exerciseData[name]).filter(Boolean);
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
          <CardContent>
            <Textarea
              placeholder="Describe your workout... e.g., 4x8 back squat at 70kg, 20 min tempo run"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              className="min-h-[120px]"
              data-testid="input-freetext"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select Exercises</CardTitle>
            </CardHeader>
            <CardContent>
              <ExerciseSelector
                selectedExercises={selectedExercises}
                onToggle={handleToggleExercise}
              />
            </CardContent>
          </Card>

          {selectedExercises.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Exercise Details</h2>
              {selectedExercises.map((name) => (
                <ExerciseInput
                  key={name}
                  exercise={exerciseData[name] || { exerciseName: name, category: EXERCISE_DEFINITIONS[name].category, sets: [createDefaultSet(1)] }}
                  onChange={handleExerciseChange}
                  onRemove={() => handleRemoveExercise(name)}
                  weightUnit={weightUnit}
                  distanceUnit={distanceUnit}
                />
              ))}
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
