import React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VoiceFieldButton } from "@/components/VoiceFieldButton";

import type { WorkoutAccessoryNotesProps } from "./types";

export const WorkoutAccessoryNotes = React.memo(function WorkoutAccessoryNotes({
  editForm,
  setEditForm,
  appendToField,
  stopAccessoryRef,
  stopNotesRef,
}: Readonly<WorkoutAccessoryNotesProps>) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="detail-accessory">Accessory/Engine Work</Label>
          <VoiceFieldButton
            onTranscript={(text) => appendToField("accessory", text)}
            onStopRef={stopAccessoryRef}
            data-testid="button-voice-detail-accessory"
          />
        </div>
        <Textarea
          id="detail-accessory"
          value={editForm.accessory}
          onChange={(e) =>
            setEditForm({ ...editForm, accessory: e.target.value })
          }
          rows={2}
          data-testid="input-detail-accessory"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="detail-notes">Notes</Label>
          <VoiceFieldButton
            onTranscript={(text) => appendToField("notes", text)}
            onStopRef={stopNotesRef}
            data-testid="button-voice-detail-notes"
          />
        </div>
        <Input
          id="detail-notes"
          value={editForm.notes}
          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
          data-testid="input-detail-notes"
          placeholder="Add any observations or notes..."
        />
      </div>
    </>
  );
});
