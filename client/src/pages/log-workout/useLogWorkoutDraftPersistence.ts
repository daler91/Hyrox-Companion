import { useEffect, useMemo, useState } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import type { useToast } from "@/hooks/use-toast";
import {
  hasAnnouncedDraftRestore,
  type LoadedDraft,
  loadLogWorkoutDraft,
  markAnnouncedDraftRestore,
  saveLogWorkoutDraft,
} from "@/hooks/useLogWorkoutDraft";

const DRAFT_SAVE_DEBOUNCE_MS = 400;

export function useInitialLogWorkoutDraft(userKey: string): LoadedDraft | null {
  // Load the draft synchronously once on mount so hook initializers can
  // hydrate from it without re-reading localStorage on every render.
  const [initialDraft] = useState(() => loadLogWorkoutDraft(userKey));
  return initialDraft;
}

interface UseLogWorkoutDraftPersistenceOptions {
  readonly userKey: string;
  readonly initialDraft: LoadedDraft | null;
  readonly title: string;
  readonly date: string;
  readonly freeText: string;
  readonly notes: string;
  readonly rpe: number | null;
  readonly useTextMode: boolean;
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly toast: ReturnType<typeof useToast>["toast"];
}

export function useLogWorkoutDraftPersistence({
  userKey,
  initialDraft,
  title,
  date,
  freeText,
  notes,
  rpe,
  useTextMode,
  exerciseBlocks,
  exerciseData,
  toast,
}: UseLogWorkoutDraftPersistenceOptions) {
  // Uses the block counter derived from the highest seen suffix so restored
  // drafts keep producing unique block IDs when the user adds more exercises.
  const currentBlockCounter = useMemo(() => {
    let max = 0;
    for (const id of exerciseBlocks) {
      const parts = id.split("__");
      const n = Number.parseInt(parts.at(-1) ?? "", 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }, [exerciseBlocks]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      saveLogWorkoutDraft(userKey, {
        title,
        date,
        freeText,
        notes,
        rpe,
        useTextMode,
        exerciseBlocks,
        exerciseData,
        blockCounter: currentBlockCounter,
      });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timerId);
  }, [
    userKey,
    title,
    date,
    freeText,
    notes,
    rpe,
    useTextMode,
    exerciseBlocks,
    exerciseData,
    currentBlockCounter,
  ]);

  useEffect(() => {
    if (initialDraft && !hasAnnouncedDraftRestore(userKey)) {
      toast({
        title: "Draft restored",
        description: "We brought back your in-progress workout.",
      });
      markAnnouncedDraftRestore(userKey);
    }
  }, [initialDraft, toast, userKey]);
}
