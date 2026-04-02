import type { InsertWorkoutLog, ParsedExercise } from "@shared/schema";
import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { queryClient } from "@/lib/queryClient";
import { api, QUERY_KEYS } from "@/lib/api";
import { generateSummary, exerciseToPayload } from "@/hooks/useWorkoutEditor";
import type { StructuredExercise } from "@/components/ExerciseInput";
import { getMissingFieldWarnings } from "@/lib/exerciseWarnings";

interface UseWorkoutFormProps {
  useTextMode: boolean;
  exerciseBlocks: string[];
  exerciseData: Record<string, StructuredExercise>;
  weightLabel: string;
  distanceUnit: string;
}

export function useWorkoutForm({
  useTextMode,
  exerciseBlocks,
  exerciseData,
  weightLabel,
  distanceUnit,
}: UseWorkoutFormProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [freeText, setFreeText] = useState("");
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);

  const handleVoiceError = useCallback(
    (msg: string) => {
      toast({ title: "Voice Input", description: msg, variant: "destructive" });
    },
    [toast]
  );

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

  const voiceInput = useVoiceInput({
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  const notesVoiceInput = useVoiceInput({
    onResult: handleNotesVoiceResult,
    onError: handleVoiceError,
  });

  const saveMutation = useMutation({
    mutationFn: (workoutData: Omit<InsertWorkoutLog, "userId"> & { title?: string, exercises?: ParsedExercise[] }) =>
      api.workouts.create(workoutData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
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

    if (!title.trim()) {
      toast({
        title: "Missing title",
        description: "Please enter a workout title.",
        variant: "destructive",
      });
      return;
    }

    if (useTextMode) {
      if (!freeText.trim()) {
        toast({
          title: "Missing workout details",
          description: "Please describe your workout.",
          variant: "destructive",
        });
        return;
      }
      saveMutation.mutate({
        title,
        date,
        focus: title,
        mainWorkout: freeText,
        notes: notes || null,
        rpe: rpe || null,
      });
    } else {
      if (exerciseBlocks.length === 0) {
        toast({
          title: "No exercises",
          description: "Please add at least one exercise.",
          variant: "destructive",
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

      const mainWorkout = generateSummary(exercises, weightLabel, distanceUnit);

      saveMutation.mutate({
        title,
        date,
        focus: title,
        mainWorkout,
        notes: notes || null,
        rpe: rpe || null,
        exercises: exercises.map(exerciseToPayload),
      });
    }
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
