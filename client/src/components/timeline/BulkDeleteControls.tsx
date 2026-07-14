import { Loader2, Trash2 } from "lucide-react";

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

import { BulkDeleteToolbar } from "./BulkDeleteToolbar";

interface BulkDeleteControlsProps {
  readonly enabled: boolean;
  readonly selectedCount: number;
  readonly visibleCount: number;
  readonly isPending: boolean;
  readonly confirmOpen: boolean;
  readonly onConfirmOpenChange: (open: boolean) => void;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function BulkDeleteControls({
  enabled,
  selectedCount,
  visibleCount,
  isPending,
  confirmOpen,
  onConfirmOpenChange,
  onSelectAll,
  onClear,
  onCancel,
  onDelete,
  onConfirmDelete,
}: Readonly<BulkDeleteControlsProps>) {
  if (!enabled) return null;

  return (
    <>
      <BulkDeleteToolbar
        selectedCount={selectedCount}
        visibleCount={visibleCount}
        isPending={isPending}
        onSelectAll={onSelectAll}
        onClear={onClear}
        onCancel={onCancel}
        onDelete={onDelete}
      />

      <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected workouts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {selectedCount} selected workout{selectedCount === 1 ? "" : "s"} from
              your timeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmDelete}
              disabled={isPending || selectedCount === 0}
              data-testid="button-confirm-bulk-delete"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
