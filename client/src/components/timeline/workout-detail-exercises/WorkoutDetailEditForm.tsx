import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Type, Dumbbell, Mic } from "lucide-react";
import { RpeSelector } from "@/components/RpeSelector";
import { useWorkoutVoiceForm } from "@/hooks/useWorkoutVoiceForm";
import { useBlockCounts } from "@/hooks/useBlockCounts";
import { WorkoutAccessoryNotes } from "./WorkoutAccessoryNotes";
import { WorkoutTextMode } from "./WorkoutTextMode";
import { WorkoutBlockMode } from "./WorkoutBlockMode";
import type { WorkoutDetailEditFormProps } from "./types";

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
  dialogSensors,
  handleEditDragEnd,
  handleAddExercise,
  handleRemoveBlock,
  updateBlock,
  getSelectedExerciseNames,
  parseMutation,
  weightUnit,
  distanceUnit,
  onParseText,
  stopAllVoiceRef,
}: WorkoutDetailEditFormProps) {
  const { blockCounts, blockIndices } = useBlockCounts(editExercises, editExerciseData);

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
      {/* Left Column */}
      <div className="md:col-span-5 lg:col-span-4 space-y-4 min-w-0">
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

        <WorkoutAccessoryNotes
          editForm={editForm}
          setEditForm={setEditForm}
          appendToField={appendToField}
          stopAccessoryRef={stopAccessoryRef}
          stopNotesRef={stopNotesRef}
        />

        {source !== "strava" && <RpeSelector value={editRpe} onChange={setEditRpe} compact />}
      </div>

      {/* Right Column */}
      <div className="md:col-span-7 lg:col-span-8 space-y-4 min-w-0">
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
          {isSupported && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                stopAllVoice();
                if (!useTextMode) setUseTextMode(true);
                startMainListening();
              }}
              data-testid="button-detail-mode-voice"
              title="Use voice input"
            >
              <Mic className="h-4 w-4 mr-1" />
              Voice
            </Button>
          )}
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
          <WorkoutBlockMode
            editExercises={editExercises}
            editExerciseData={editExerciseData}
            dialogSensors={dialogSensors}
            handleEditDragEnd={handleEditDragEnd}
            handleAddExercise={handleAddExercise}
            handleRemoveBlock={handleRemoveBlock}
            updateBlock={updateBlock}
            getSelectedExerciseNames={getSelectedExerciseNames}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            blockCounts={blockCounts}
            blockIndices={blockIndices}
          />
        )}
      </div>
    </div>
  );
});
