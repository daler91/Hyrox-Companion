import type { InsertWorkoutLog, ParsedExercise } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef,useState } from "react";
import { useLocation } from "wouter";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { exerciseToPayload,generateSummary } from "@/hooks/useWorkoutEditor";
import { api, QUERY_KEYS } from "@/lib/api";
import { getMissingFieldWarnings } from "@/lib/exerciseWarnings";
import { queryClient } from "@/lib/queryClient";

interface UseWorkoutFormProps {
  /**
   * Retained only for draft persistence; save branching keys off
   * `exerciseBlocks.length` so a workout with parsed rows saves as
   * structured regardless of how the text panel is currently toggled.
   */
  useTextMode: boolean;
  exerciseBlocks: string[];
  exerciseData: Record<string, StructuredExercise>;
  weightLabel: string;
  distanceUnit: string;
  initialValues?: {
    title?: string;
    date?: string;
    freeText?: string;
    notes?: string;
    rpe?: number | null;
  };
  /**
   * Fires synchronously on successful save, BEFORE the post-save navigation.
   * Consumers use this to run cleanup (e.g. clearing the localStorage draft)
   * that must complete while the LogWorkout tree is still mounted.
   */
  onSaveSuccess?: () => void;
}

export function useWorkoutForm({
  // Kept in the contract for draft callers; save branches on
  // exerciseBlocks.length so the old "force text mode" branch is gone.
  useTextMode: _useTextMode,
  exerciseBlocks,
  exerciseData,
  weightLabel,
  distanceUnit,
  initialValues,
  onSaveSuccess,
}: UseWorkoutFormProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [date, setDate] = useState(initialValues?.date ?? new Date().toISOString().split("T")[0]);
  const [freeText, setFreeText] = useState(initialValues?.freeText ?? "");
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [rpe, setRpe] = useState<number | null>(initialValues?.rpe ?? null);

  const handleVoiceResult = useCallback((transcript: string) => {
    setFreeText((prev) => {
      const separator =
        prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  const handleNotesVoiceResult = useCallback((transcript: string) => {
    setNotes((prev) => {
      const separator =
        prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  // Refs let the error handlers reference each hook's startListening function
  // without creating a chicken-and-egg with the hook return value. The refs
  // are populated right after the hooks are initialized below.
  const startVoiceRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const startNotesVoiceRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const handleVoiceError = useCallback(
    (msg: string) => {
      toast({
        title: "Voice input failed",
        description: msg,
        variant: "destructive",
        action: (
          <ToastAction
            altText="Retry voice input"
            data-testid="button-voice-retry"
            onClick={() => {
              startVoiceRef.current().catch(() => {});
            }}
          >
            Try again
          </ToastAction>
        ),
      });
    },
    [toast],
  );

  const handleNotesVoiceError = useCallback(
    (msg: string) => {
      toast({
        title: "Voice input failed",
        description: msg,
        variant: "destructive",
        action: (
          <ToastAction
            altText="Retry notes voice input"
            data-testid="button-voice-retry-notes"
            onClick={() => {
              startNotesVoiceRef.current().catch(() => {});
            }}
          >
            Try again
          </ToastAction>
        ),
      });
    },
    [toast],
  );

  const voiceInput = useVoiceInput({
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  const notesVoiceInput = useVoiceInput({
    onResult: handleNotesVoiceResult,
    onError: handleNotesVoiceError,
  });

  useEffect(() => {
    startVoiceRef.current = voiceInput.startListening;
    startNotesVoiceRef.current = notesVoiceInput.startListening;
  }, [voiceInput.startListening, notesVoiceInput.startListening]);

  const saveMutation = useMutation({
    mutationFn: (workoutData: Omit<InsertWorkoutLog, "userId"> & { title?: string, exercises?: ParsedExercise[] }) =>
      api.workouts.create(workoutData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
      // Paired with staleTime: Infinity on analytics queries — see
      // CODEBASE_REVIEW_2026-04-12.md #27.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
      // Run any consumer-supplied cleanup (e.g. clearing the draft) before
      // we navigate away, so the unmount doesn't race with it.
      onSaveSuccess?.();
      toast({
        title: "Workout logged",
        description: "Your workout has been saved successfully.",
      });
      navigate("/");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save workout. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (voiceInput.isListening) voiceInput.stopListening();
    if (notesVoiceInput.isListening) notesVoiceInput.stopListening();

    const effectiveTitle = title.trim() || "Workout";
    const hasStructured = exerciseBlocks.length > 0;

    if (!hasStructured) {
      if (!freeText.trim()) {
        toast({
          title: "Missing workout details",
          description: "Please add an exercise or describe your workout.",
          variant: "destructive",
        });
        return;
      }
      // Text-only fallback: the auto-parse couldn't produce structured
      // rows (or the user bypassed it). Save the raw free-text and let
      // the reparse pipeline hydrate the table next time the detail
      // dialog opens.
      saveMutation.mutate({
        title: effectiveTitle,
        date,
        focus: effectiveTitle,
        mainWorkout: freeText,
        notes: notes || null,
        rpe: rpe || null,
      });
      return;
    }

    const exercises = exerciseBlocks
      .map((id) => exerciseData[id])
      .filter(Boolean);

    const allWarnings = exercises.flatMap((ex) => getMissingFieldWarnings(ex));
    if (allWarnings.length > 0) {
      const uniqueWarnings = [...new Set(allWarnings)];
      toast({
        title: "Some data is missing",
        description: uniqueWarnings.slice(0, 3).join(". ") + (uniqueWarnings.length > 3 ? ` (+${uniqueWarnings.length - 3} more)` : "") + ". Saving anyway — you can edit later.",
      });
    }

    // Prefer the user's raw description when they typed one so the
    // saved workout keeps their voice — otherwise synthesise from the
    // structured rows. Summary is used by list/timeline views that
    // don't load exerciseSets.
    const mainWorkout = freeText.trim()
      ? freeText
      : generateSummary(exercises, weightLabel, distanceUnit);

    saveMutation.mutate({
      title: effectiveTitle,
      date,
      focus: effectiveTitle,
      mainWorkout,
      notes: notes || null,
      rpe: rpe || null,
      exercises: exercises.map(exerciseToPayload),
    });
  };

  return {
    title,
    setTitle,
    date,
    setDate,
    freeText,
    setFreeText,
    notes,
    setNotes,
    rpe,
    setRpe,
    voiceInput,
    notesVoiceInput,
    saveMutation,
    handleSave,
  };
}
