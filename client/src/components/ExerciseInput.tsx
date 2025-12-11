import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Timer, Ruler, Hash, Weight, Pencil } from "lucide-react";
import type { ExerciseType } from "./WorkoutCard";

interface ExerciseData {
  type: ExerciseType;
  customName?: string;
  time?: number;
  distance?: number;
  reps?: number;
  weight?: number;
  notes?: string;
}

interface ExerciseInputProps {
  exercise: ExerciseData;
  onChange: (exercise: ExerciseData) => void;
  onRemove: () => void;
}

const exerciseLabels: Record<ExerciseType, string> = {
  running: "Running",
  skierg: "SkiErg",
  sled_push: "Sled Push",
  sled_pull: "Sled Pull",
  burpees: "Burpees",
  rowing: "Rowing",
  farmers_carry: "Farmers Carry",
  wall_balls: "Wall Balls",
  other: "Other",
};

const exerciseFields: Record<ExerciseType, ("time" | "distance" | "reps" | "weight")[]> = {
  running: ["time", "distance"],
  skierg: ["time", "distance"],
  sled_push: ["time", "distance", "weight"],
  sled_pull: ["time", "distance", "weight"],
  burpees: ["time", "reps"],
  rowing: ["time", "distance"],
  farmers_carry: ["time", "distance", "weight"],
  wall_balls: ["time", "reps", "weight"],
  other: ["time", "distance", "reps", "weight"],
};

const exerciseBorderColors: Record<ExerciseType, string> = {
  running: "border-l-blue-500",
  skierg: "border-l-purple-500",
  sled_push: "border-l-orange-500",
  sled_pull: "border-l-amber-500",
  burpees: "border-l-red-500",
  rowing: "border-l-cyan-500",
  farmers_carry: "border-l-green-500",
  wall_balls: "border-l-pink-500",
  other: "border-l-gray-500",
};

export function ExerciseInput({ exercise, onChange, onRemove }: ExerciseInputProps) {
  const fields = exerciseFields[exercise.type];

  const handleChange = (field: keyof ExerciseData, value: string) => {
    if (field === "customName") {
      onChange({
        ...exercise,
        customName: value || undefined,
      });
    } else {
      onChange({
        ...exercise,
        [field]: value ? Number(value) : undefined,
      });
    }
  };

  const displayLabel = exercise.type === "other" && exercise.customName 
    ? exercise.customName 
    : exerciseLabels[exercise.type];

  return (
    <Card className={`border-l-4 ${exerciseBorderColors[exercise.type]} rounded-l-none`} data-testid={`input-exercise-${exercise.type}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h4 className="font-semibold">{displayLabel}</h4>
          <Button size="icon" variant="ghost" onClick={onRemove} data-testid={`button-remove-${exercise.type}`}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {exercise.type === "other" && (
          <div className="mb-4">
            <Label className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Pencil className="h-3 w-3" />
              Exercise Name
            </Label>
            <Input
              type="text"
              placeholder="Enter exercise name"
              value={exercise.customName || ""}
              onChange={(e) => handleChange("customName", e.target.value)}
              data-testid="input-custom-exercise-name"
            />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {fields.includes("time") && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Timer className="h-3 w-3" />
                Time (min)
              </Label>
              <Input
                type="number"
                placeholder="0"
                value={exercise.time || ""}
                onChange={(e) => handleChange("time", e.target.value)}
                data-testid={`input-time-${exercise.type}`}
              />
            </div>
          )}
          {fields.includes("distance") && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Ruler className="h-3 w-3" />
                Distance (m)
              </Label>
              <Input
                type="number"
                placeholder="0"
                value={exercise.distance || ""}
                onChange={(e) => handleChange("distance", e.target.value)}
                data-testid={`input-distance-${exercise.type}`}
              />
            </div>
          )}
          {fields.includes("reps") && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Hash className="h-3 w-3" />
                Reps
              </Label>
              <Input
                type="number"
                placeholder="0"
                value={exercise.reps || ""}
                onChange={(e) => handleChange("reps", e.target.value)}
                data-testid={`input-reps-${exercise.type}`}
              />
            </div>
          )}
          {fields.includes("weight") && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Weight className="h-3 w-3" />
                Weight (kg)
              </Label>
              <Input
                type="number"
                placeholder="0"
                value={exercise.weight || ""}
                onChange={(e) => handleChange("weight", e.target.value)}
                data-testid={`input-weight-${exercise.type}`}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
