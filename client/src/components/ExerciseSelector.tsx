import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wind,
  ArrowRight,
  ArrowLeft,
  Zap,
  Ship,
  Dumbbell,
  Target,
  Plus,
  PersonStanding,
  Footprints,
  Timer,
  Flame,
  CircleDot,
} from "lucide-react";
import { EXERCISE_DEFINITIONS, type ExerciseName, type ExerciseCategory } from "@shared/schema";
import React from "react";
import { categoryLabels } from "@/lib/exerciseUtils";

interface ExerciseSelectorProps {
  readonly selectedExercises: ExerciseName[];
  readonly onToggle: (name: ExerciseName) => void;
  readonly onAdd?: (name: ExerciseName) => void;
  readonly allowDuplicates?: boolean;
}

const exerciseIcons: Partial<Record<ExerciseName, typeof Wind>> = {
  skierg: Wind,
  sled_push: ArrowRight,
  sled_pull: ArrowLeft,
  burpee_broad_jump: Zap,
  rowing: Ship,
  farmers_carry: Dumbbell,
  sandbag_lunges: Footprints,
  wall_balls: Target,
  easy_run: PersonStanding,
  tempo_run: PersonStanding,
  interval_run: Timer,
  long_run: PersonStanding,
  back_squat: Dumbbell,
  front_squat: Dumbbell,
  deadlift: Dumbbell,
  romanian_deadlift: Dumbbell,
  bench_press: Dumbbell,
  overhead_press: Dumbbell,
  pull_up: Dumbbell,
  bent_over_row: Dumbbell,
  lunges: Footprints,
  hip_thrust: Dumbbell,
  burpees: Zap,
  box_jumps: Flame,
  assault_bike: CircleDot,
  kettlebell_swings: Dumbbell,
  battle_ropes: Flame,
  custom: Plus,
};

const selectorCategoryLabels: Record<ExerciseCategory, string> = {
  ...categoryLabels,
  functional: "Functional",
} as Record<ExerciseCategory, string>;

const categoryOrder: ExerciseCategory[] = ["functional", "running", "strength", "conditioning"];

// ⚡ Bolt Performance Optimization:
// Move static array allocation and filtering outside of the component.
// This prevents O(N) object entries allocation and O(N) array filtering
// from running on every single render of the ExerciseSelector.
const exercisesByCategory = categoryOrder.map(cat => ({
  category: cat,
  label: selectorCategoryLabels[cat],
  exercises: (Object.entries(EXERCISE_DEFINITIONS) as [ExerciseName, typeof EXERCISE_DEFINITIONS[ExerciseName]][])
    .filter(([, def]) => def.category === cat),
}));

export function ExerciseSelector({ selectedExercises, onToggle, onAdd, allowDuplicates = false }: Readonly<ExerciseSelectorProps>) {
  const selectedCounts = React.useMemo(() => {
    const counts: Partial<Record<ExerciseName, number>> = {};
    for (const name of selectedExercises) {
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  }, [selectedExercises]);

  const countOf = (name: ExerciseName) => selectedCounts[name] || 0;

  return (
    <div className="space-y-4" data-testid="exercise-selector">
      {exercisesByCategory.map(({ category, label, exercises }) => (
        <div key={category}>
          <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
          <div className="flex flex-wrap gap-2">
            {exercises.map(([name, def]) => {
              const count = countOf(name);
              const isSelected = count > 0;
              const Icon = exerciseIcons[name] || Plus;

              if (allowDuplicates) {
                return (
                  <Button
                    key={name}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => (onAdd ? onAdd(name) : onToggle(name))}
                    data-testid={`button-exercise-${name}`}
                  >
                    <Icon className="h-3.5 w-3.5 mr-1.5" />
                    {def.label}
                    {count > 0 && (
                      <Badge variant="secondary" className="ml-1.5 h-4 min-w-[1rem] px-1 text-[10px]">
                        {count}
                      </Badge>
                    )}
                  </Button>
                );
              }

              return (
                <Button
                  key={name}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => onToggle(name)}
                  data-testid={`button-exercise-${name}`}
                  aria-pressed={isSelected}
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5" />
                  {def.label}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
