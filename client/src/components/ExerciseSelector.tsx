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

interface ExerciseSelectorProps {
  selectedExercises: ExerciseName[];
  onToggle: (name: ExerciseName) => void;
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

const categoryLabels: Record<ExerciseCategory, string> = {
  hyrox_station: "Hyrox Stations",
  running: "Running",
  strength: "Strength",
  conditioning: "Conditioning",
};

const categoryOrder: ExerciseCategory[] = ["hyrox_station", "running", "strength", "conditioning"];

export function ExerciseSelector({ selectedExercises, onToggle }: ExerciseSelectorProps) {
  const exercisesByCategory = categoryOrder.map(cat => ({
    category: cat,
    label: categoryLabels[cat],
    exercises: (Object.entries(EXERCISE_DEFINITIONS) as [ExerciseName, typeof EXERCISE_DEFINITIONS[ExerciseName]][])
      .filter(([, def]) => def.category === cat),
  }));

  return (
    <div className="space-y-4" data-testid="exercise-selector">
      {exercisesByCategory.map(({ category, label, exercises }) => (
        <div key={category}>
          <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
          <div className="flex flex-wrap gap-2">
            {exercises.map(([name, def]) => {
              const isSelected = selectedExercises.includes(name);
              const Icon = exerciseIcons[name] || Plus;
              return (
                <Button
                  key={name}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => onToggle(name)}
                  data-testid={`button-exercise-${name}`}
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
