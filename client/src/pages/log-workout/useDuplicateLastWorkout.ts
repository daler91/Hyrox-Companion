import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";

import type { StructuredExercise } from "@/components/ExerciseInput";
import type { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { exerciseSetsToStructured } from "@/lib/exerciseUtils";

interface UseDuplicateLastWorkoutOptions {
  readonly setDate: (value: string) => void;
  readonly setRpe: (value: number | null) => void;
  readonly setTitle: (value: string) => void;
  readonly setNotes: (value: string) => void;
  readonly setFreeText: (value: string) => void;
  readonly setPlanDayId: (value: string | null) => void;
  readonly resetEditor: (
    blocks: string[],
    data: Record<string, StructuredExercise>,
    textMode: boolean,
  ) => void;
  readonly toast: ReturnType<typeof useToast>["toast"];
}

export function useDuplicateLastWorkout({
  setDate,
  setRpe,
  setTitle,
  setNotes,
  setFreeText,
  setPlanDayId,
  resetEditor,
  toast,
}: UseDuplicateLastWorkoutOptions) {
  const duplicateLastMutation = useMutation({
    mutationFn: () => api.workouts.latest(),
    onSuccess: (latest) => {
      setDate(format(new Date(), "yyyy-MM-dd"));
      setRpe(null);
      // The server stores the user-facing title in `focus`; the form's
      // "title" input binds to the same field on save.
      setTitle(latest.focus ?? "");
      setNotes(latest.notes ?? "");
      setPlanDayId(null);

      const hasStructuredExercises = latest.exerciseSets && latest.exerciseSets.length > 0;
      if (hasStructuredExercises) {
        const { names, data } = exerciseSetsToStructured(latest.exerciseSets);
        resetEditor(names, data, false);
        setFreeText("");
      } else {
        // Older entries / imports / pure free-text logs fall back to the
        // raw main-workout text in the text-mode editor.
        resetEditor([], {}, true);
        setFreeText(latest.mainWorkout ?? "");
      }

      toast({
        title: "Duplicated last workout",
        description: `${latest.focus ?? "Workout"} - date reset to today`,
      });
    },
    onError: (err: unknown) => {
      const isNotFound = err instanceof Error && /not found|404/i.test(err.message);
      toast({
        title: isNotFound ? "No previous workout" : "Couldn't duplicate workout",
        description: isNotFound
          ? "Log your first workout to enable quick duplication."
          : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    handleDuplicateLast: () => duplicateLastMutation.mutate(),
    isDuplicating: duplicateLastMutation.isPending,
  };
}
