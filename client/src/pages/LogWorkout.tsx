import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { ExerciseInput } from "@/components/ExerciseInput";
import { useToast } from "@/hooks/use-toast";
import { Save, ArrowLeft, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ExerciseType } from "@/components/WorkoutCard";

interface ExerciseData {
  type: ExerciseType;
  time?: number;
  distance?: number;
  reps?: number;
  weight?: number;
  notes?: string;
}

export default function LogWorkout() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedExercises, setSelectedExercises] = useState<ExerciseType[]>([]);
  const [exerciseData, setExerciseData] = useState<Record<ExerciseType, ExerciseData>>({} as Record<ExerciseType, ExerciseData>);
  const [notes, setNotes] = useState("");

  const saveMutation = useMutation({
    mutationFn: async (workoutData: {
      title: string;
      date: string;
      focus: string;
      mainWorkout: string;
      notes: string | null;
    }) => {
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
      navigate("/timeline");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save workout. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleToggleExercise = (type: ExerciseType) => {
    setSelectedExercises((prev) => {
      if (prev.includes(type)) {
        const newData = { ...exerciseData };
        delete newData[type];
        setExerciseData(newData);
        return prev.filter((t) => t !== type);
      } else {
        setExerciseData((prevData) => ({
          ...prevData,
          [type]: { type },
        }));
        return [...prev, type];
      }
    });
  };

  const handleExerciseChange = (exercise: ExerciseData) => {
    setExerciseData((prev) => ({
      ...prev,
      [exercise.type]: exercise,
    }));
  };

  const handleRemoveExercise = (type: ExerciseType) => {
    setSelectedExercises((prev) => prev.filter((t) => t !== type));
    setExerciseData((prev) => {
      const newData = { ...prev };
      delete newData[type];
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

    if (selectedExercises.length === 0) {
      toast({
        title: "No exercises",
        description: "Please add at least one exercise.",
        variant: "destructive",
      });
      return;
    }

    const exerciseDetails = selectedExercises.map((type) => {
      const data = exerciseData[type];
      const parts = [];
      if (data?.time) parts.push(`${data.time}min`);
      if (data?.distance) parts.push(`${data.distance}m`);
      if (data?.reps) parts.push(`${data.reps} reps`);
      if (data?.weight) parts.push(`${data.weight}kg`);
      return `${type}: ${parts.join(", ") || "completed"}`;
    });

    saveMutation.mutate({
      title,
      date,
      focus: title,
      mainWorkout: exerciseDetails.join("; "),
      notes: notes || null,
    });
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
          {selectedExercises.map((type) => (
            <ExerciseInput
              key={type}
              exercise={exerciseData[type] || { type }}
              onChange={handleExerciseChange}
              onRemove={() => handleRemoveExercise(type)}
            />
          ))}
        </div>
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
