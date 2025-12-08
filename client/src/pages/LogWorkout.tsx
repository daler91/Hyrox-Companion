import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { ExerciseInput } from "@/components/ExerciseInput";
import { useToast } from "@/hooks/use-toast";
import { Save, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
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
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedExercises, setSelectedExercises] = useState<ExerciseType[]>([]);
  const [exerciseData, setExerciseData] = useState<Record<ExerciseType, ExerciseData>>({} as Record<ExerciseType, ExerciseData>);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

  const handleSave = async () => {
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

    setIsSaving(true);

    // todo: remove mock functionality - replace with actual API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("Saving workout:", {
      title,
      date,
      exercises: selectedExercises.map((type) => exerciseData[type]),
      notes,
    });

    toast({
      title: "Workout logged",
      description: "Your workout has been saved successfully.",
    });

    setTitle("");
    setSelectedExercises([]);
    setExerciseData({} as Record<ExerciseType, ExerciseData>);
    setNotes("");
    setIsSaving(false);
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
        disabled={isSaving}
        className="w-full"
        size="lg"
        data-testid="button-save-workout"
      >
        <Save className="h-4 w-4 mr-2" />
        {isSaving ? "Saving..." : "Save Workout"}
      </Button>
    </div>
  );
}
