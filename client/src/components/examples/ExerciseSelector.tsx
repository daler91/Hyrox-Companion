import { useState } from "react";
import { ExerciseSelector } from "../ExerciseSelector";
import type { ExerciseType } from "../WorkoutCard";

export default function ExerciseSelectorExample() {
  const [selected, setSelected] = useState<ExerciseType[]>(["running", "skierg"]);

  const handleToggle = (type: ExerciseType) => {
    setSelected((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="p-4 max-w-xl">
      <ExerciseSelector selectedExercises={selected} onToggle={handleToggle} />
    </div>
  );
}
