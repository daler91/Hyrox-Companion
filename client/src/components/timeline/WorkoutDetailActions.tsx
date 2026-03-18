import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Pencil,
  Trash2,
  Combine,
  Save,
  X,
} from "lucide-react";
import { type TimelineEntry, type WorkoutStatus } from "@shared/schema";

interface StatusChangeSectionProps {
  readonly entry: TimelineEntry;
  readonly onMarkComplete: (entry: TimelineEntry) => void;
  readonly onChangeStatus: (entry: TimelineEntry, status: WorkoutStatus) => void;
}

export function StatusChangeSection({ entry, onMarkComplete, onChangeStatus }: Readonly<StatusChangeSectionProps>) {
  return (
    <>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Change Status</p>
        <div className="flex flex-wrap gap-2">
          {entry.status !== "completed" && (
            <Button
              size="sm"
              variant="outline"
              className="text-green-600 border-green-200 dark:border-green-800"
              onClick={() => onMarkComplete(entry)}
              data-testid="button-detail-complete"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Complete
            </Button>
          )}
          {entry.status !== "skipped" && (
            <Button
              size="sm"
              variant="outline"
              className="text-yellow-600 border-yellow-200 dark:border-yellow-800"
              onClick={() => onChangeStatus(entry, "skipped")}
              data-testid="button-detail-skip"
            >
              <SkipForward className="h-4 w-4 mr-1" />
              Skip
            </Button>
          )}
          {entry.status !== "missed" && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-200 dark:border-red-800"
              onClick={() => onChangeStatus(entry, "missed")}
              data-testid="button-detail-missed"
            >
              <XCircle className="h-4 w-4 mr-1" />
              Missed
            </Button>
          )}
          {entry.status !== "planned" && (
            <Button
              size="sm"
              variant="outline"
              className="text-blue-600 border-blue-200 dark:border-blue-800"
              onClick={() => onChangeStatus(entry, "planned")}
              data-testid="button-detail-planned"
            >
              <Clock className="h-4 w-4 mr-1" />
              Planned
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

interface WorkoutDetailFooterProps {
  readonly isEditing: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly isSaving?: boolean;
  readonly isDeleting?: boolean;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
  readonly onCombine?: () => void;
}

export function WorkoutDetailFooter({
  isEditing,
  canEdit,
  canDelete,
  isSaving,
  isDeleting,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onClose,
  onCombine,
}: Readonly<WorkoutDetailFooterProps>) {
  return (
    <DialogFooter className="flex-col sm:flex-row gap-2">
      {isEditing ? (
        <>
          <Button
            variant="outline"
            onClick={onCancelEdit}
            className="sm:mr-auto"
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={isSaving}
            data-testid="button-detail-save"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Changes
          </Button>
        </>
      ) : (
        <>
          <div className="flex gap-2 sm:mr-auto flex-wrap">
            {canEdit && (
              <Button
                variant="outline"
                onClick={onEdit}
                data-testid="button-detail-edit"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
            {onCombine && (
              <Button
                variant="outline"
                onClick={onCombine}
                data-testid="button-detail-combine"
              >
                <Combine className="h-4 w-4 mr-1" />
                Combine
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={onDelete}
                disabled={isDeleting}
                data-testid="button-detail-delete"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Delete
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </>
      )}
    </DialogFooter>
  );
}

interface DeleteConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly isDeleting?: boolean;
}

export function DeleteConfirmDialog({ open, onOpenChange, onConfirm, isDeleting }: Readonly<DeleteConfirmDialogProps>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Workout</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this workout? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete"
          >
            {isDeleting ? "Deleting..." : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
