import { ListChecks, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface BulkDeleteToolbarProps {
  readonly selectedCount: number;
  readonly visibleCount: number;
  readonly isPending: boolean;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}

export function BulkDeleteToolbar({
  selectedCount,
  visibleCount,
  isPending,
  onSelectAll,
  onClear,
  onCancel,
  onDelete,
}: Readonly<BulkDeleteToolbarProps>) {
  return (
    <div
      className="sticky top-4 z-30 flex flex-col gap-3 rounded-md border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between"
      data-testid="bulk-delete-toolbar"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium" role="status" aria-live="polite">
          {selectedCount} selected
        </p>
        <p className="text-xs text-muted-foreground">
          {visibleCount} visible workout{visibleCount === 1 ? "" : "s"} can be removed
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={onSelectAll}
          disabled={isPending || visibleCount === 0 || selectedCount === visibleCount}
          data-testid="button-bulk-select-all"
        >
          <ListChecks className="mr-2 h-4 w-4" />
          Select all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={onClear}
          disabled={isPending || selectedCount === 0}
          data-testid="button-bulk-clear"
        >
          <X className="mr-2 h-4 w-4" />
          Clear
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={onDelete}
          disabled={isPending || selectedCount === 0}
          data-testid="button-bulk-delete-selected"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete selected
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={onCancel}
          disabled={isPending}
          data-testid="button-bulk-cancel"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
