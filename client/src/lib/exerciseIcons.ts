import type { ExerciseName } from "@shared/schema";
import {
  ArrowLeft,
  ArrowRight,
  CircleDot,
  Dumbbell,
  Flame,
  Footprints,
  type LucideIcon,
  PersonStanding,
  Plus,
  Ship,
  Target,
  Timer,
  Wind,
  Zap,
} from "lucide-react";

export const exerciseIcons: Partial<Record<ExerciseName, LucideIcon>> = {
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

export function getExerciseIcon(name: ExerciseName): LucideIcon {
  return exerciseIcons[name] ?? Plus;
}
