import { useState } from "react";
import { ExerciseInput } from "../ExerciseInput";
import type { ExerciseType } from "../WorkoutCard";

interface ExerciseData {
  type: ExerciseType;
  time?: number;
  distance?: number;
  reps?: number;
  weight?: number;
  notes?: string;
}

export default function ExerciseInputExample() {
  const [exercise1, setExercise1] = useState<ExerciseData>({ type: "running", time: 8, distance: 1000 });
  const [exercise2, setExercise2] = useState<ExerciseData>({ type: "wall_balls", reps: 100, weight: 9 });

  return (
    <div className="space-y-4 p-4 max-w-2xl">
      <ExerciseInput
        exercise={exercise1}
        onChange={setExercise1}
        onRemove={() => console.log("Remove running")}
      />
      <ExerciseInput
        exercise={exercise2}
        onChange={setExercise2}
        onRemove={() => console.log("Remove wall balls")}
      />
    </div>
  );
}
