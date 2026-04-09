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
    <div className="space-y-6">
      {/* Focus field - always on top */}
      <div>
        <Label htmlFor="detail-focus">Focus</Label>
        <Input
          id="detail-focus"
          value={editForm.focus}
          onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
          data-testid="input-detail-focus"
          placeholder="e.g., Upper Body Strength, Active Recovery..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column - secondary fields (after exercises on mobile) */}
        <div className="order-2 md:order-1 md:col-span-5 lg:col-span-4 space-y-4 min-w-0">
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

        {/* Right Column - exercises (shown first on mobile) */}
        <div className="order-1 md:order-2 md:col-span-7 lg:col-span-8 space-y-4 min-w-0">
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
      </div>
    </div>
  );
});
