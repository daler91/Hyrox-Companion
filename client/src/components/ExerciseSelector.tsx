import { Button } from "@/components/ui/button";
import { 
  PersonStanding, 
  Wind, 
  ArrowRight, 
  ArrowLeft, 
  Zap, 
  Ship, 
  Dumbbell, 
  Target,
  Plus
} from "lucide-react";
import type { ExerciseType } from "./WorkoutCard";

interface ExerciseSelectorProps {
  selectedExercises: ExerciseType[];
  onToggle: (type: ExerciseType) => void;
}

const exercises: { type: ExerciseType; label: string; icon: typeof PersonStanding }[] = [
  { type: "running", label: "Running", icon: PersonStanding },
  { type: "skierg", label: "SkiErg", icon: Wind },
  { type: "sled_push", label: "Sled Push", icon: ArrowRight },
  { type: "sled_pull", label: "Sled Pull", icon: ArrowLeft },
  { type: "burpees", label: "Burpees", icon: Zap },
  { type: "rowing", label: "Rowing", icon: Ship },
  { type: "farmers_carry", label: "Farmers Carry", icon: Dumbbell },
  { type: "wall_balls", label: "Wall Balls", icon: Target },
  { type: "other", label: "Other", icon: Plus },
];

export function ExerciseSelector({ selectedExercises, onToggle }: ExerciseSelectorProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="exercise-selector">
      {exercises.map(({ type, label, icon: Icon }) => {
        const isSelected = selectedExercises.includes(type);
        return (
          <Button
            key={type}
            variant={isSelected ? "default" : "outline"}
            className="h-auto py-3 flex flex-col gap-1"
            onClick={() => onToggle(type)}
            data-testid={`button-exercise-${type}`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-xs">{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
