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
  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onOpenChange(false)}>
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
            <Label htmlFor="edit-main">Main Workout</Label>
            <Textarea
              id="edit-main"
              value={editForm.mainWorkout}
              onChange={(e) => onEditFormChange({ ...editForm, mainWorkout: e.target.value })}
              rows={3}
              data-testid="input-edit-main"
            />
          </div>
          <div>
            <Label htmlFor="edit-accessory">Accessory/Engine Work</Label>
            <Textarea
              id="edit-accessory"
              value={editForm.accessory}
              onChange={(e) => onEditFormChange({ ...editForm, accessory: e.target.value })}
              rows={2}
              data-testid="input-edit-accessory"
            />
          </div>
          <div>
            <Label htmlFor="edit-notes">Notes</Label>
            <Input
              id="edit-notes"
              value={editForm.notes}
              onChange={(e) => onEditFormChange({ ...editForm, notes: e.target.value })}
              data-testid="input-edit-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
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
