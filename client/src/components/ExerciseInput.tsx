import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import { Hash, Pencil, Ruler, Timer, Weight } from "lucide-react";
import { useId, useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryBorderColors } from "@/lib/exerciseUtils";
import { getExerciseMissingFields } from "@/lib/exerciseWarnings";

import type { FieldConfig, FieldKey } from "./exercise-input";
import { ExerciseHeader, ExerciseWarnings, MultiSetTable, SingleSetFields } from "./exercise-input";

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

const fieldConfig: Record<FieldKey, FieldConfig> = {
  reps: { icon: Hash, getLabel: () => "Reps", short: "Reps" },
  weight: { icon: Weight, getLabel: (wu) => `Weight (${wu})`, short: "Wt" },
  distance: {
    icon: Ruler,
    getLabel: (_, du) => `Distance (${du === "km" ? "m" : "ft"})`,
    short: "Dist",
  },
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

export function createExerciseFromSets(
  exerciseName: ExerciseName,
  dbSets: Array<{
    setNumber: number;
    reps?: number | null;
    weight?: number | null;
    distance?: number | null;
    time?: number | null;
    notes?: string | null;
  }>,
): StructuredExercise {
  const def = EXERCISE_DEFINITIONS[exerciseName];
  return {
    exerciseName,
    category: def?.category || "conditioning",
    sets: dbSets.map((s) => ({
      setNumber: s.setNumber,
      reps: s.reps ?? undefined,
      weight: s.weight ?? undefined,
      distance: s.distance ?? undefined,
      time: s.time ?? undefined,
      notes: s.notes ?? undefined,
    })),
  };
}

interface ExerciseInputProps {
  readonly exercise: StructuredExercise;
  readonly onChange: (exercise: StructuredExercise) => void;
  readonly onRemove: () => void;
  readonly weightUnit?: "kg" | "lbs";
  readonly distanceUnit?: "km" | "miles";
  readonly blockLabel?: string;
}

export function ExerciseInput({
  exercise,
  onChange,
  onRemove,
  weightUnit = "kg",
  distanceUnit = "km",
  blockLabel,
}: Readonly<ExerciseInputProps>) {
  const idPrefix = useId();
  const def = EXERCISE_DEFINITIONS[exercise.exerciseName];
  const fields = getFields(exercise.exerciseName);
  const borderColor = categoryBorderColors[exercise.category] || "border-l-gray-500";
  const displayLabel =
    exercise.exerciseName === "custom" && exercise.customLabel
      ? exercise.customLabel
      : def?.label || exercise.exerciseName;

  const sets = exercise.sets.length > 0 ? exercise.sets : [createDefaultSet(1)];

  const missingFields = useMemo(() => {
    return getExerciseMissingFields(exercise);
  }, [exercise]);

  const handleSetChange = (idx: number, field: string, value: string) => {
    const updatedSets = [...sets];
    updatedSets[idx] = { ...updatedSets[idx], [field]: value ? Number(value) : undefined };
    onChange({ ...exercise, sets: updatedSets });
  };

  const addSet = () => {
    const lastSet = sets.at(-1);
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
    // ⚡ Bolt Performance Optimization:
    // Combine filter and map into a single pass to avoid unnecessary array allocations
    // and multiple O(N) traversals during frequent UI state updates.
    const newSets = sets.reduce(
      (acc, s, i) => {
        if (i !== idx) {
          acc.push({ ...s, setNumber: acc.length + 1 });
        }
        return acc;
      },
      [] as typeof sets,
    );
    onChange({ ...exercise, sets: newSets });
  };

  const showMultiSetView = fields.includes("reps") || fields.includes("weight");

  return (
    <Card
      className={`border-l-4 ${borderColor} rounded-l-none`}
      data-testid={`input-exercise-${exercise.exerciseName}`}
    >
      <CardContent className="p-4">
        <ExerciseHeader
          displayLabel={displayLabel}
          blockLabel={blockLabel}
          setCount={sets.length}
          exerciseName={exercise.exerciseName}
          confidence={exercise.confidence}
          onRemove={onRemove}
        />

        <ExerciseWarnings missingFields={missingFields} exerciseName={exercise.exerciseName} />

        {exercise.exerciseName === "custom" && (
          <div className="mb-4">
            <Label
              htmlFor={`${idPrefix}-custom-name`}
              className="flex items-center gap-1 text-xs text-muted-foreground mb-2"
            >
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
          <MultiSetTable
            exerciseName={exercise.exerciseName}
            fields={fields}
            fieldConfig={fieldConfig}
            sets={sets}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onSetChange={handleSetChange}
            onAddSet={addSet}
            onRemoveSet={removeSet}
          />
        ) : (
          <SingleSetFields
            exerciseName={exercise.exerciseName}
            idPrefix={idPrefix}
            fields={fields}
            fieldConfig={fieldConfig}
            set={sets[0]}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onSetChange={handleSetChange}
          />
        )}
      </CardContent>
    </Card>
  );
}
