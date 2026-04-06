import type { TimelineEntry } from "@shared/schema";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect,useRef } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VoiceFieldButton } from "@/components/VoiceFieldButton";
import { type EditFormState as BaseEditFormState } from "@/hooks/useWorkoutVoiceForm";

export interface EditFormState extends BaseEditFormState {
  rpe: number | null;
}

interface EditWorkoutDialogProps {
  readonly entry: TimelineEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly editForm: EditFormState;
  readonly onEditFormChange: (form: EditFormState) => void;
  readonly onSave: () => void;
  readonly isPending: boolean;
}

export default function EditWorkoutDialog({
  entry,
  onOpenChange,
  editForm,
  onEditFormChange,
  onSave,
  isPending,
}: Readonly<EditWorkoutDialogProps>) {
  const editFormRef = useRef(editForm);
  useEffect(() => {
    editFormRef.current = editForm;
  }, [editForm]);

  const stopMainRef = useRef<(() => void) | null>(null);
  const stopAccessoryRef = useRef<(() => void) | null>(null);
  const stopNotesRef = useRef<(() => void) | null>(null);

  const stopAllVoice = useCallback(() => {
    stopMainRef.current?.();
    stopAccessoryRef.current?.();
    stopNotesRef.current?.();
  }, []);

  const appendToField = useCallback(
    (field: "focus" | "mainWorkout" | "accessory" | "notes", text: string) => {
      const current = editFormRef.current;
      const val = current[field];
      const separator =
        val && !val.endsWith(" ") && !val.endsWith("\n") ? " " : "";
      onEditFormChange({
        ...current,
        [field]: val + separator + text,
      });
    },
    [onEditFormChange],
  );

  const handleSave = useCallback(() => {
    stopAllVoice();
    onSave();
  }, [stopAllVoice, onSave]);

  const handleClose = useCallback(() => {
    stopAllVoice();
    onOpenChange(false);
  }, [stopAllVoice, onOpenChange]);

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Edit {entry?.dayName} - Week {entry?.weekNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Metadata & Notes */}
          <div className="space-y-4 min-w-0">
            <div>
              <Label htmlFor="edit-focus">Focus</Label>
              <Input
                id="edit-focus"
                value={editForm.focus}
                onChange={(e) =>
                  onEditFormChange({ ...editForm, focus: e.target.value })
                }
                data-testid="input-edit-focus"
                placeholder="e.g., Upper Body Strength, Active Recovery..."
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="edit-notes">Notes</Label>
                <VoiceFieldButton
                  onTranscript={(text) => appendToField("notes", text)}
                  onStopRef={stopNotesRef}
                  data-testid="button-voice-edit-notes"
                />
              </div>
              <Input
                id="edit-notes"
                value={editForm.notes}
                onChange={(e) =>
                  onEditFormChange({ ...editForm, notes: e.target.value })
                }
                data-testid="input-edit-notes"
                placeholder="Add any observations or notes..."
              />
            </div>
            {entry?.source !== "strava" && (
              <RpeSelector
                value={editForm.rpe}
                onChange={(rpe) => onEditFormChange({ ...editForm, rpe })}
                compact
              />
            )}
          </div>

          {/* Right Column: Workouts */}
          <div className="space-y-4 flex flex-col">
            <div className="flex-1 flex flex-col">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="edit-main">Main Workout</Label>
                  <VoiceFieldButton
                    onTranscript={(text) => appendToField("mainWorkout", text)}
                    onStopRef={stopMainRef}
                    data-testid="button-voice-edit-main"
                  />
                </div>
                <Textarea
                  id="edit-main"
                  value={editForm.mainWorkout}
                  onChange={(e) =>
                    onEditFormChange({
                      ...editForm,
                      mainWorkout: e.target.value,
                    })
                  }
                  rows={5}
                  className="flex-1"
                  data-testid="input-edit-main"
                />
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="edit-accessory">Accessory/Engine Work</Label>
                  <VoiceFieldButton
                    onTranscript={(text) => appendToField("accessory", text)}
                    onStopRef={stopAccessoryRef}
                    data-testid="button-voice-edit-accessory"
                  />
                </div>
                <Textarea
                  id="edit-accessory"
                  value={editForm.accessory}
                  onChange={(e) =>
                    onEditFormChange({ ...editForm, accessory: e.target.value })
                  }
                  rows={4}
                  className="flex-1"
                  data-testid="input-edit-accessory"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            data-testid="button-save-edit"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
