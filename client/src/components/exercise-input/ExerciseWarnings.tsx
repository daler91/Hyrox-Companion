import { TriangleAlert } from "lucide-react";

interface ExerciseWarningsProps {
  readonly missingFields: string[];
  readonly exerciseName: string;
}

export function ExerciseWarnings({ missingFields, exerciseName }: ExerciseWarningsProps) {
  if (missingFields.length === 0) return null;

  return (
    <div className="flex items-start gap-2 mb-3 p-2 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-xs" role="alert" aria-live="assertive" data-testid={`warning-missing-${exerciseName}`}>
      <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>Missing {missingFields.join(", ").toLowerCase()} — add for better tracking</span>
    </div>
  );
}
