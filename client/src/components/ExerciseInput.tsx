import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Timer, Ruler, Hash, Weight, Pencil, Layers } from "lucide-react";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";

export interface StructuredExercise {
  exerciseName: ExerciseName;
  category: string;
  customLabel?: string;
  sets?: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  notes?: string;
}

interface ExerciseInputProps {
  exercise: StructuredExercise;
  onChange: (exercise: StructuredExercise) => void;
  onRemove: () => void;
  weightUnit?: "kg" | "lbs";
  distanceUnit?: "km" | "miles";
}

const categoryColors: Record<string, string> = {
  hyrox_station: "border-l-orange-500",
  running: "border-l-blue-500",
  strength: "border-l-purple-500",
  conditioning: "border-l-red-500",
};

type FieldKey = "sets" | "reps" | "weight" | "distance" | "time";

const fieldConfig: Record<FieldKey, { icon: typeof Timer; getLabel: (wu: string, du: string) => string }> = {
  sets: { icon: Layers, getLabel: () => "Sets" },
  reps: { icon: Hash, getLabel: () => "Reps" },
  weight: { icon: Weight, getLabel: (wu) => `Weight (${wu})` },
  distance: { icon: Ruler, getLabel: (_, du) => `Distance (${du === "km" ? "m" : "ft"})` },
  time: { icon: Timer, getLabel: () => "Time (min)" },
};

export function ExerciseInput({ exercise, onChange, onRemove, weightUnit = "kg", distanceUnit = "km" }: ExerciseInputProps) {
  const def = EXERCISE_DEFINITIONS[exercise.exerciseName];
  const fields = def ? (def.fields as readonly string[]) : ["sets", "reps", "weight", "distance", "time"];
  const borderColor = categoryColors[exercise.category] || "border-l-gray-500";
  const displayLabel = exercise.exerciseName === "custom" && exercise.customLabel
    ? exercise.customLabel
    : def?.label || exercise.exerciseName;

  const handleChange = (field: string, value: string) => {
    if (field === "customLabel") {
      onChange({ ...exercise, customLabel: value || undefined });
    } else {
      onChange({ ...exercise, [field]: value ? Number(value) : undefined });
    }
  };

  return (
    <Card className={`border-l-4 ${borderColor} rounded-l-none`} data-testid={`input-exercise-${exercise.exerciseName}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h4 className="font-semibold">{displayLabel}</h4>
          <Button size="icon" variant="ghost" onClick={onRemove} data-testid={`button-remove-${exercise.exerciseName}`}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {exercise.exerciseName === "custom" && (
          <div className="mb-4">
            <Label className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Pencil className="h-3 w-3" />
              Exercise Name
            </Label>
            <Input
              type="text"
              placeholder="Enter exercise name"
              value={exercise.customLabel || ""}
              onChange={(e) => handleChange("customLabel", e.target.value)}
              data-testid="input-custom-exercise-name"
            />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(fields as FieldKey[]).map((field) => {
            const config = fieldConfig[field];
            if (!config) return null;
            const Icon = config.icon;
            return (
              <div key={field} className="space-y-2">
                <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  {config.getLabel(weightUnit, distanceUnit)}
                </Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={exercise[field] || ""}
                  onChange={(e) => handleChange(field, e.target.value)}
                  data-testid={`input-${field}-${exercise.exerciseName}`}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
