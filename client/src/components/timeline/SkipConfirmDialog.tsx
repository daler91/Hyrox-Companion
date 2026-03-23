import type { TimelineEntry } from "@shared/schema";
import { ConfirmDialog } from "./ConfirmDialog";

interface SkipConfirmDialogProps {
  readonly entry: TimelineEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

export default function SkipConfirmDialog({
  entry,
  onOpenChange,
  onConfirm,
}: Readonly<SkipConfirmDialogProps>) {
  return (
    <ConfirmDialog
      open={!!entry}
      onOpenChange={(open) => !open && onOpenChange(false)}
      title="Skip this workout?"
      description={`This will mark "${entry?.focus}" as skipped. You can still go back and complete it later if needed.`}
      confirmText="Skip Workout"
      cancelText="Cancel"
      onConfirm={onConfirm}
      cancelTestId="button-cancel-skip"
      confirmTestId="button-confirm-skip"
    />
  );
}
