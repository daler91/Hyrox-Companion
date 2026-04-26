import type { ExerciseName, ParsedExercise } from "@shared/schema";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { WorkoutComposer } from "@/components/workout/WorkoutComposer";
import { WorkoutDetailsCard } from "@/components/workout/WorkoutDetailsCard";
import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";
import { WorkoutSaveButton } from "@/components/workout/WorkoutSaveButton";
import type { useToast } from "@/hooks/use-toast";
import type { ParseFromImagePayload } from "@/lib/api";

interface LogWorkoutFormLayoutProps {
  readonly title: string;
  readonly setTitle: (value: string) => void;
  readonly date: string;
  readonly setDate: (value: string) => void;
  readonly rpe: number | null;
  readonly setRpe: (value: number | null) => void;
  readonly notes: string;
  readonly setNotes: (value: string) => void;
  readonly freeText: string;
  readonly setFreeText: (value: string) => void;
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly addExercise: (name: ExerciseName, customLabel?: string) => void;
  readonly updateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly removeBlock: (blockId: string) => void;
  readonly reorderBlocks: (nextOrder: string[]) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly autoParsing: boolean;
  readonly autoParseError: boolean;
  readonly parseNow: (text: string) => void;
  readonly cancelAutoParse: () => void;
  readonly isListening: boolean;
  readonly isSupported: boolean;
  readonly interimTranscript: string;
  readonly toggleListening: () => void;
  readonly stopListening: () => void;
  readonly isNotesListening: boolean;
  readonly isNotesSupported: boolean;
  readonly notesInterim: string;
  readonly toggleNotesListening: () => void;
  readonly handleSave: () => void;
  readonly isSaving: boolean;
  readonly handleCancel: () => void;
  readonly hasWorkoutDetails: boolean;
  readonly handleDuplicateLast: () => void;
  readonly isDuplicating: boolean;
  readonly defaultPanelOpen?: boolean;
  readonly toast: ReturnType<typeof useToast>["toast"];
  readonly onParseImage: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (parsed: ParsedExercise[]) => void },
  ) => void;
  readonly isParsingImage: boolean;
}

export function LogWorkoutFormLayout({
  title,
  setTitle,
  date,
  setDate,
  rpe,
  setRpe,
  notes,
  setNotes,
  freeText,
  setFreeText,
  exerciseBlocks,
  exerciseData,
  addExercise,
  updateBlock,
  removeBlock,
  reorderBlocks,
  weightUnit,
  distanceUnit,
  autoParsing,
  autoParseError,
  parseNow,
  cancelAutoParse,
  isListening,
  isSupported,
  interimTranscript,
  toggleListening,
  stopListening,
  isNotesListening,
  isNotesSupported,
  notesInterim,
  toggleNotesListening,
  handleSave,
  isSaving,
  handleCancel,
  hasWorkoutDetails,
  handleDuplicateLast,
  isDuplicating,
  defaultPanelOpen,
  toast,
  onParseImage,
  isParsingImage,
}: LogWorkoutFormLayoutProps) {
  return (
    <div className="container max-w-5xl mx-auto p-4 pb-28 md:pb-8 pt-4 md:pt-8 min-h-screen">
      <WorkoutHeader onDuplicateLast={handleDuplicateLast} isDuplicating={isDuplicating} />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
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
            isPending={isSaving}
            onCancel={handleCancel}
            hasWorkoutDetails={hasWorkoutDetails}
          />
        </div>

        <div className="md:col-span-7 lg:col-span-8 space-y-6">
          <WorkoutComposer
            freeText={freeText}
            setFreeText={setFreeText}
            exerciseBlocks={exerciseBlocks}
            exerciseData={exerciseData}
            addExercise={addExercise}
            updateBlock={updateBlock}
            removeBlock={removeBlock}
            reorderBlocks={reorderBlocks}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            autoParsing={autoParsing}
            autoParseError={autoParseError}
            parseNow={parseNow}
            cancelAutoParse={cancelAutoParse}
            isListening={isListening}
            isSupported={isSupported}
            interimTranscript={interimTranscript}
            toggleListening={toggleListening}
            stopListening={stopListening}
            toast={toast}
            defaultPanelOpen={defaultPanelOpen}
            onParseImage={onParseImage}
            isParsingImage={isParsingImage}
          />
        </div>
      </div>
    </div>
  );
}
