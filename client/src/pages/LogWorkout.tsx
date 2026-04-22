import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { WorkoutComposer } from "@/components/workout/WorkoutComposer";
import { WorkoutDetailsCard } from "@/components/workout/WorkoutDetailsCard";
import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";
import { WorkoutSaveButton } from "@/components/workout/WorkoutSaveButton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  clearLogWorkoutDraft,
  hasAnnouncedDraftRestore,
  loadLogWorkoutDraft,
  markAnnouncedDraftRestore,
  saveLogWorkoutDraft,
} from "@/hooks/useLogWorkoutDraft";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutEditor } from "@/hooks/useWorkoutEditor";
import { useWorkoutForm } from "@/hooks/useWorkoutForm";
import { api } from "@/lib/api";
import { exerciseSetsToStructured } from "@/lib/exerciseUtils";

const DRAFT_SAVE_DEBOUNCE_MS = 400;

/**
 * Top-level LogWorkout page. Gates the form on auth resolution so the
 * inner LogWorkoutForm can load the real user's draft on its first
 * render — without this gate, a slow Clerk hydration would initialize
 * the draft under "anon", and the subsequent autosave effect would
 * overwrite (and then blank-delete) the authenticated user's draft.
 */
export default function LogWorkout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  const userKey = user?.id ?? "anon";
  // Key by userKey so an in-place account switch (Clerk signing a
  // different user in without a full reload) fully remounts
  // LogWorkoutForm. The remount re-runs the lazy draft loader with the
  // new userKey, preventing the previous user's in-memory draft from
  // being autosaved under the new user's storage key.
  return <LogWorkoutForm key={userKey} userKey={userKey} />;
}

interface LogWorkoutFormProps {
  userKey: string;
}

function LogWorkoutForm({ userKey }: Readonly<LogWorkoutFormProps>) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const handleCancel = React.useCallback(() => setLocation("/"), [setLocation]);
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();

  // Load the draft synchronously once on mount (lazy initializer) so hook
  // initializers can hydrate from it without re-reading localStorage on every render.
  // Safe because userKey is now a stable prop from the auth-gated wrapper.
  const [initialDraft] = useState(() => loadLogWorkoutDraft(userKey));

  const {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    addExercise,
    removeBlock,
    updateBlock,
    resetEditor,
    autoParsing,
    autoParseError,
    scheduleAutoParse,
    cancelAutoParse,
    parseImageMutation,
  } = useWorkoutEditor({
    initialExerciseBlocks: initialDraft?.exerciseBlocks,
    initialExerciseData: initialDraft?.exerciseData,
    initialUseTextMode: initialDraft?.useTextMode,
    initialBlockCounter: initialDraft?.blockCounter,
  });

  const {
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
  } = useWorkoutForm({
    useTextMode,
    exerciseBlocks,
    exerciseData,
    weightLabel,
    distanceUnit,
    initialValues: initialDraft
      ? {
          title: initialDraft.title,
          date: initialDraft.date,
          freeText: initialDraft.freeText,
          notes: initialDraft.notes,
          rpe: initialDraft.rpe,
        }
      : undefined,
    // Clear the localStorage draft synchronously on save success, BEFORE
    // useWorkoutForm navigates away. Using a useEffect on
    // saveMutation.isSuccess races the page unmount from navigate("/"),
    // which can leave a stale draft that reappears on the next visit.
    onSaveSuccess: () => clearLogWorkoutDraft(userKey),
  });

  const {
    isListening,
    isSupported,
    interimTranscript,
    stopListening,
    toggleListening,
  } = voiceInput;

  const {
    isListening: isNotesListening,
    isSupported: isNotesSupported,
    interimTranscript: notesInterim,
    toggleListening: toggleNotesListening,
  } = notesVoiceInput;

  // Fetch the most recent workout and hydrate the form from it so the user
  // can quickly re-log a similar session. The date is reset to today and RPE
  // is cleared — those are per-session. Everything else (title, notes,
  // structured exercises OR free text) carries over.
  const duplicateLastMutation = useMutation({
    mutationFn: () => api.workouts.latest(),
    onSuccess: (latest) => {
      setDate(format(new Date(), "yyyy-MM-dd"));
      setRpe(null);
      // The server stores the user-facing title in `focus`; the form's
      // "title" input binds to the same field on save.
      setTitle(latest.focus ?? "");
      setNotes(latest.notes ?? "");

      const hasStructuredExercises = latest.exerciseSets && latest.exerciseSets.length > 0;
      if (hasStructuredExercises) {
        const { names, data } = exerciseSetsToStructured(latest.exerciseSets);
        resetEditor(names, data, false);
        setFreeText("");
      } else {
        // Older entries / Strava imports / pure free-text logs: fall back
        // to dropping the raw main-workout text into the text-mode editor.
        resetEditor([], {}, true);
        setFreeText(latest.mainWorkout ?? "");
      }

      toast({
        title: "Duplicated last workout",
        description: `${latest.focus ?? "Workout"} — date reset to today`,
      });
    },
    onError: (err: unknown) => {
      const isNotFound =
        err instanceof Error && /not found|404/i.test(err.message);
      toast({
        title: isNotFound ? "No previous workout" : "Couldn't duplicate workout",
        description: isNotFound
          ? "Log your first workout to enable quick duplication."
          : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDuplicateLast = React.useCallback(() => {
    duplicateLastMutation.mutate();
  }, [duplicateLastMutation]);

  // Debounced autosave of the current in-progress workout to localStorage.
  // Uses the block counter derived from the highest seen suffix so restored
  // drafts keep producing unique block IDs when the user adds more exercises.
  const currentBlockCounter = useMemo(() => {
    let max = 0;
    for (const id of exerciseBlocks) {
      const parts = id.split("__");
      const n = Number.parseInt(parts[parts.length - 1] ?? "", 10);
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

  // "Draft restored" toast — announced once per draft, per session.
  // LogWorkoutForm remounts on every navigation to /log, so a bare
  // mount-time toast re-fired every revisit while a draft was still present,
  // visibly overlaying other pages via the globally-mounted <Toaster />. The
  // sessionStorage guard scopes the announcement to one firing per browser
  // session; `clearLogWorkoutDraft` (called on save) resets it so the next
  // draft the user creates is announced fresh.
  useEffect(() => {
    if (initialDraft && !hasAnnouncedDraftRestore(userKey)) {
      toast({
        title: "Draft restored",
        description: "We brought back your in-progress workout.",
      });
      markAnnouncedDraftRestore(userKey);
    }
  }, [initialDraft, toast, userKey]);


  return (
    <div className="container max-w-5xl mx-auto p-4 pb-20 md:pb-8 pt-4 md:pt-8 min-h-screen">
      <WorkoutHeader
        onDuplicateLast={handleDuplicateLast}
        isDuplicating={duplicateLastMutation.isPending}
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Column: Basic Details & Notes */}
        <div className="md:col-span-5 lg:col-span-4 space-y-6 md:sticky md:top-6">
          <WorkoutDetailsCard
            title={title}
            setTitle={setTitle}
            date={date}
            setDate={setDate}
            rpe={rpe}
            setRpe={setRpe}
          />
          <WorkoutNotesCard
            notes={notes}
            setNotes={setNotes}
            isNotesListening={isNotesListening}
            isNotesSupported={isNotesSupported}
            toggleNotesListening={toggleNotesListening}
            notesInterim={notesInterim}
          />
          <WorkoutSaveButton
            handleSave={handleSave}
            isPending={saveMutation.isPending}
            onCancel={handleCancel}
          />
        </div>

        {/* Right Column: Workout Content */}
        <div className="md:col-span-7 lg:col-span-8 space-y-6">
          <WorkoutComposer
            freeText={freeText}
            setFreeText={setFreeText}
            exerciseBlocks={exerciseBlocks}
            exerciseData={exerciseData}
            addExercise={addExercise}
            updateBlock={updateBlock}
            removeBlock={removeBlock}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            autoParsing={autoParsing}
            autoParseError={autoParseError}
            scheduleAutoParse={scheduleAutoParse}
            cancelAutoParse={cancelAutoParse}
            isListening={isListening}
            isSupported={isSupported}
            interimTranscript={interimTranscript}
            toggleListening={toggleListening}
            stopListening={stopListening}
            toast={toast}
            // Only force the describe/dictate panel open when the
            // restored draft was explicitly in text mode. Leaving this
            // `undefined` otherwise lets the composer fall back to
            // "open when freeText is non-empty", so a draft that has
            // saved text but no useTextMode flag still reveals its
            // content instead of hiding it behind a collapsed panel.
            defaultPanelOpen={initialDraft?.useTextMode ? true : undefined}
            onParseImage={(payload, opts) => parseImageMutation.mutate(payload, opts)}
            isParsingImage={parseImageMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}
