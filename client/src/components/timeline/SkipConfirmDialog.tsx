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
import type { TimelineEntry } from "@shared/schema";

interface SkipConfirmDialogProps {
  readonly entry: TimelineEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

export default function SkipConfirmDialog({
  entry,
  onOpenChange,
  onConfirm,
}: SkipConfirmDialogProps) {
  return (
    <AlertDialog open={!!entry} onOpenChange={(open) => !open && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Skip this workout?</AlertDialogTitle>
          <AlertDialogDescription>
            This will mark "{entry?.focus}" as skipped. You can still go back and complete it later if needed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-skip">Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            data-testid="button-confirm-skip"
          >
            Skip Workout
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
