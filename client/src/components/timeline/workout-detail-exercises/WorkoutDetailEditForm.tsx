import { Dumbbell, Type } from "lucide-react";
import React from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkoutExerciseMode } from "@/components/workout/WorkoutExerciseMode";
import { useWorkoutVoiceForm } from "@/hooks/useWorkoutVoiceForm";

import type { WorkoutDetailEditFormProps } from "./types";
import { WorkoutAccessoryNotes } from "./WorkoutAccessoryNotes";
import { WorkoutTextMode } from "./WorkoutTextMode";

export const WorkoutDetailEditForm = React.memo(function WorkoutDetailEditForm({
  editRpe = null,
  setEditRpe = () => {},
  source = "manual",
  editForm,
  setEditForm,
  useTextMode,
  setUseTextMode,
  editExercises,
  editExerciseData,
  handleAddExercise,
  handleRemoveBlock,
  updateBlock,
  parseMutation,
  weightUnit,
  distanceUnit,
  onParseText,
  stopAllVoiceRef,
}: WorkoutDetailEditFormProps) {
  const {
    appendToField,
    stopAccessoryRef,
    stopNotesRef,
    isMainListening,
    isSupported,
    mainInterim,
    startMainListening,
    stopMainListening,
    toggleMainListening,
    stopAllVoice,
  } = useWorkoutVoiceForm(editForm, setEditForm, stopAllVoiceRef);

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
      {/* Focus field - full width, always first */}
      <div className="md:col-span-12">
        <Label htmlFor="detail-focus">Focus</Label>
        <Input
          id="detail-focus"
          value={editForm.focus}
          onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
          data-testid="input-detail-focus"
          placeholder="e.g., Upper Body Strength, Active Recovery..."
        />
      </div>

      {/* Exercises/Free Text - appears second (right column on desktop) */}
      <div className="md:col-span-7 lg:col-span-8 md:row-start-2 md:col-start-6 lg:col-start-5 space-y-4 min-w-0">
        <div className="flex items-center gap-2">
          <Button
            variant={useTextMode ? "outline" : "default"}
            size="sm"
            onClick={() => {
              stopAllVoice();
              setUseTextMode(false);
            }}
            data-testid="button-mode-exercises"
          >
            <Dumbbell className="h-4 w-4 mr-1" />
            Exercises
          </Button>
          <Button
            variant={useTextMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              stopAllVoice();
              setUseTextMode(true);
            }}
            data-testid="button-mode-freetext"
          >
            <Type className="h-4 w-4 mr-1" />
            Free Text
          </Button>
        </div>

        {useTextMode ? (
          <WorkoutTextMode
            editForm={editForm}
            setEditForm={setEditForm}
            isMainListening={isMainListening}
            isSupported={isSupported}
            mainInterim={mainInterim}
            startMainListening={startMainListening}
            stopMainListening={stopMainListening}
            toggleMainListening={toggleMainListening}
            onParseText={onParseText}
            parseMutation={parseMutation}
          />
        ) : (
          <WorkoutExerciseMode
            exerciseBlocks={editExercises}
            exerciseData={editExerciseData}
            addExercise={handleAddExercise}
            updateBlock={updateBlock}
            removeBlock={handleRemoveBlock}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
          />
        )}
      </div>

      {/* Secondary fields - appears third on mobile, left column on desktop */}
      <div className="md:col-span-5 lg:col-span-4 md:row-start-2 md:col-start-1 space-y-4 min-w-0">
        <WorkoutAccessoryNotes
          editForm={editForm}
          setEditForm={setEditForm}
          appendToField={appendToField}
          stopAccessoryRef={stopAccessoryRef}
          stopNotesRef={stopNotesRef}
        />

        {source !== "strava" && (
          <RpeSelector value={editRpe} onChange={setEditRpe} compact />
        )}
      </div>
    </div>
  );
});
