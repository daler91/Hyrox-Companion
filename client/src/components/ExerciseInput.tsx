import { useState, useId, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Timer, Ruler, Hash, Weight, Pencil, Plus, Minus, Copy, AlertTriangle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import { categoryBorderColors } from "@/lib/exerciseUtils";
import { getExerciseMissingFields } from "@/lib/exerciseWarnings";

export interface SetData {
  setNumber: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  notes?: string;
}

export interface StructuredExercise {
  exerciseName: ExerciseName;
  category: string;
  customLabel?: string;
  confidence?: number;
  missingFields?: string[];
  sets: SetData[];
}

interface ExerciseInputProps {
  readonly exercise: StructuredExercise;
  readonly onChange: (exercise: StructuredExercise) => void;
  readonly onRemove: () => void;
  readonly weightUnit?: "kg" | "lbs";
  readonly distanceUnit?: "km" | "miles";
  readonly blockLabel?: string;
}

type FieldKey = "reps" | "weight" | "distance" | "time";

const fieldConfig: Record<FieldKey, { icon: typeof Timer; getLabel: (wu: string, du: string) => string; short: string }> = {
  reps: { icon: Hash, getLabel: () => "Reps", short: "Reps" },
  weight: { icon: Weight, getLabel: (wu) => `Weight (${wu})`, short: "Wt" },
  distance: { icon: Ruler, getLabel: (_, du) => `Distance (${du === "km" ? "m" : "ft"})`, short: "Dist" },
  time: { icon: Timer, getLabel: () => "Time (min)", short: "Time" },
};

function getFields(exerciseName: ExerciseName): FieldKey[] {
  const def = EXERCISE_DEFINITIONS[exerciseName];
  if (!def) return ["reps", "weight", "distance", "time"];
  const defFields = def.fields as readonly string[];
  return defFields.filter((f): f is FieldKey => f !== "sets" && f in fieldConfig);
}

export function createDefaultSet(setNumber: number): SetData {
  return { setNumber };
}

export function createExerciseFromSets(exerciseName: ExerciseName, dbSets: Array<{ setNumber: number; reps?: number | null; weight?: number | null; distance?: number | null; time?: number | null; notes?: string | null }>): StructuredExercise {
  const def = EXERCISE_DEFINITIONS[exerciseName];
  return {
    exerciseName,
    category: def?.category || "conditioning",
    sets: dbSets.map(s => ({
      setNumber: s.setNumber,
      reps: s.reps ?? undefined,
      weight: s.weight ?? undefined,
      distance: s.distance ?? undefined,
      time: s.time ?? undefined,
      notes: s.notes ?? undefined,
    })),
  };
}


function getConfidenceClasses(confidence: number): string {
  if (confidence >= 80) return "bg-green-500/10 text-green-600 dark:text-green-400";
  if (confidence >= 60) return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
  return "bg-red-500/10 text-red-600 dark:text-red-400";
}

export function ExerciseInput({ exercise, onChange, onRemove, weightUnit = "kg", distanceUnit = "km", blockLabel }: Readonly<ExerciseInputProps>) {
  const idPrefix = useId();
  const def = EXERCISE_DEFINITIONS[exercise.exerciseName];
  const fields = getFields(exercise.exerciseName);
  const borderColor = categoryBorderColors[exercise.category] || "border-l-gray-500";
  const displayLabel = exercise.exerciseName === "custom" && exercise.customLabel
    ? exercise.customLabel
    : def?.label || exercise.exerciseName;

  const sets = exercise.sets.length > 0 ? exercise.sets : [createDefaultSet(1)];

  const missingFields = useMemo(() => {
    return getExerciseMissingFields(exercise);
  }, [exercise]);

  const handleSetChange = (idx: number, field: string, value: string) => {
    const newSets = [...sets];
    newSets[idx] = { ...newSets[idx], [field]: value ? Number(value) : undefined };
    onChange({ ...exercise, sets: newSets });
  };

  const addSet = () => {
    const lastSet = sets[sets.length - 1];
    const newSet: SetData = {
      setNumber: sets.length + 1,
      reps: lastSet?.reps,
      weight: lastSet?.weight,
      distance: lastSet?.distance,
      time: lastSet?.time,
    };
    onChange({ ...exercise, sets: [...sets, newSet] });
  };

  const removeSet = (idx: number) => {
    if (sets.length <= 1) return;
    const newSets = sets.filter((_, i) => i !== idx).map((s, i) => ({ ...s, setNumber: i + 1 }));
    onChange({ ...exercise, sets: newSets });
  };

  const showMultiSetView = fields.includes("reps") || fields.includes("weight");

  return (
    <Card className={`border-l-4 ${borderColor} rounded-l-none`} data-testid={`input-exercise-${exercise.exerciseName}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold">{displayLabel}{blockLabel ? ` ${blockLabel}` : ""}</h4>
            <span className="text-xs text-muted-foreground">{sets.length} {sets.length === 1 ? "set" : "sets"}</span>
            {exercise.confidence != null && exercise.confidence < 90 && (
              <Badge
                variant="secondary"
                className={`text-[10px] ${getConfidenceClasses(exercise.confidence)}`}
                data-testid={`badge-confidence-${exercise.exerciseName}`}
              >
                {exercise.confidence < 60 && <AlertTriangle className="h-3 w-3 mr-0.5" />}
                AI {exercise.confidence}%
              </Badge>
            )}
          </div>
          <Button size="icon" variant="ghost" onClick={onRemove} data-testid={`button-remove-${exercise.exerciseName}`} aria-label={`Remove ${displayLabel}`}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {missingFields.length > 0 && (
          <div className="flex items-start gap-2 mb-3 p-2 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-xs" data-testid={`warning-missing-${exercise.exerciseName}`}>
            <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Missing {missingFields.join(", ").toLowerCase()} — add for better tracking</span>
          </div>
        )}

        {exercise.exerciseName === "custom" && (
          <div className="mb-4">
            <Label htmlFor={`${idPrefix}-custom-name`} className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Pencil className="h-3 w-3" />
              Exercise Name
            </Label>
            <Input
              id={`${idPrefix}-custom-name`}
              type="text"
              placeholder="Enter exercise name"
              value={exercise.customLabel || ""}
              onChange={(e) => onChange({ ...exercise, customLabel: e.target.value || undefined })}
              data-testid="input-custom-exercise-name"
            />
          </div>
        )}

        {showMultiSetView ? (
          <div className="space-y-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: `2rem ${fields.map(() => "1fr").join(" ")} 2rem` }}>
              <div className="text-xs text-muted-foreground font-medium flex items-end pb-1">#</div>
              {fields.map((field) => {
                const config = fieldConfig[field];
                return (
                  <div key={field} className="text-xs text-muted-foreground font-medium flex items-end pb-1">
                    {config.getLabel(weightUnit, distanceUnit)}
                  </div>
                );
              })}
              <div />
            </div>
            {sets.map((set, idx) => (
              <div key={set.setNumber} className="grid gap-2 items-center" style={{ gridTemplateColumns: `2rem ${fields.map(() => "1fr").join(" ")} 2rem` }} data-testid={`set-row-${exercise.exerciseName}-${idx}`}>
                <span className="text-xs text-muted-foreground text-center">{set.setNumber}</span>
                {fields.map((field) => (
                  <Input
                    key={field}
                    type="number"
                    placeholder="--"
                    value={set[field] ?? ""}
                    onChange={(e) => handleSetChange(idx, field, e.target.value)}
                    className="h-8 text-sm"
                    data-testid={`input-${field}-${exercise.exerciseName}-${idx}`}
                    aria-label={`${fieldConfig[field].getLabel(weightUnit, distanceUnit)} for set ${set.setNumber}`}
                  />
                ))}
                <Button size="icon" variant="ghost" onClick={() => removeSet(idx)} disabled={sets.length <= 1} className="h-6 w-6" data-testid={`button-remove-set-${idx}`} aria-label={`Remove set ${idx + 1}`}>
                  <Minus className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addSet} className="w-full mt-2" data-testid={`button-add-set-${exercise.exerciseName}`}>
              <Plus className="h-3 w-3 mr-1" /> Add Set
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {fields.map((field) => {
              const config = fieldConfig[field];
              const Icon = config.icon;
              const inputId = `${idPrefix}-${field}`;
              return (
                <div key={field} className="space-y-2">
                  <Label htmlFor={inputId} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon className="h-3 w-3" />
                    {config.getLabel(weightUnit, distanceUnit)}
                  </Label>
                  <Input
                    id={inputId}
                    type="number"
                    placeholder="0"
                    value={sets[0]?.[field] ?? ""}
                    onChange={(e) => handleSetChange(0, field, e.target.value)}
                    data-testid={`input-${field}-${exercise.exerciseName}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
