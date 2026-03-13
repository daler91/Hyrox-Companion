import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { TimelineEntry } from "@shared/schema";
import { VoiceFieldButton } from "@/components/VoiceFieldButton";

export interface EditFormState {
  focus: string;
  mainWorkout: string;
  accessory: string;
  notes: string;
}

interface EditWorkoutDialogProps {
  entry: TimelineEntry | null;
  onOpenChange: (open: boolean) => void;
  editForm: EditFormState;
  onEditFormChange: (form: EditFormState) => void;
  onSave: () => void;
  isPending: boolean;
}

export default function EditWorkoutDialog({
  entry,
  onOpenChange,
  editForm,
  onEditFormChange,
  onSave,
  isPending,
}: EditWorkoutDialogProps) {
  const editFormRef = useRef(editForm);
  editFormRef.current = editForm;

  const stopMainRef = useRef<(() => void) | null>(null);
  const stopAccessoryRef = useRef<(() => void) | null>(null);
  const stopNotesRef = useRef<(() => void) | null>(null);

  const stopAllVoice = useCallback(() => {
    stopMainRef.current?.();
    stopAccessoryRef.current?.();
    stopNotesRef.current?.();
  }, []);

  const appendToField = useCallback((field: keyof EditFormState, text: string) => {
    const current = editFormRef.current;
    const val = current[field];
    const separator = val && !val.endsWith(" ") && !val.endsWith("\n") ? " " : "";
    onEditFormChange({
      ...current,
      [field]: val + separator + text,
    });
  }, [onEditFormChange]);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit {entry?.dayName} - Week {entry?.weekNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-focus">Focus</Label>
            <Input
              id="edit-focus"
              value={editForm.focus}
              onChange={(e) => onEditFormChange({ ...editForm, focus: e.target.value })}
              data-testid="input-edit-focus"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="edit-main">Main Workout</Label>
              <VoiceFieldButton onTranscript={(text) => appendToField("mainWorkout", text)} onStopRef={stopMainRef} data-testid="button-voice-edit-main" />
            </div>
            <Textarea
              id="edit-main"
              value={editForm.mainWorkout}
              onChange={(e) => onEditFormChange({ ...editForm, mainWorkout: e.target.value })}
              rows={3}
              data-testid="input-edit-main"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="edit-accessory">Accessory/Engine Work</Label>
              <VoiceFieldButton onTranscript={(text) => appendToField("accessory", text)} onStopRef={stopAccessoryRef} data-testid="button-voice-edit-accessory" />
            </div>
            <Textarea
              id="edit-accessory"
              value={editForm.accessory}
              onChange={(e) => onEditFormChange({ ...editForm, accessory: e.target.value })}
              rows={2}
              data-testid="input-edit-accessory"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="edit-notes">Notes</Label>
              <VoiceFieldButton onTranscript={(text) => appendToField("notes", text)} onStopRef={stopNotesRef} data-testid="button-voice-edit-notes" />
            </div>
            <Input
              id="edit-notes"
              value={editForm.notes}
              onChange={(e) => onEditFormChange({ ...editForm, notes: e.target.value })}
              data-testid="input-edit-notes"
            />
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
