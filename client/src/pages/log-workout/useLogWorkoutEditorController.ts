import { useMemo } from "react";

import { useWorkoutEditor } from "@/hooks/useWorkoutEditor";

interface Params {
  initialDraft: {
    exerciseBlocks: ReturnType<typeof useWorkoutEditor>["exerciseBlocks"];
    exerciseData: ReturnType<typeof useWorkoutEditor>["exerciseData"];
    useTextMode: boolean;
    blockCounter: number;
  } | null;
}

export function useLogWorkoutEditorController({ initialDraft }: Readonly<Params>) {
  const editor = useWorkoutEditor({
    initialExerciseBlocks: initialDraft?.exerciseBlocks,
    initialExerciseData: initialDraft?.exerciseData,
    initialUseTextMode: initialDraft?.useTextMode,
    initialBlockCounter: initialDraft?.blockCounter,
  });

  const hasWorkoutBlockDetails = useMemo(
    () => editor.exerciseBlocks.length > 0,
    [editor.exerciseBlocks.length],
  );

  return { editor, hasWorkoutBlockDetails };
}
