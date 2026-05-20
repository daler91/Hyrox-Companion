import { Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface TimelineHeaderProps {
  readonly canBulkDelete?: boolean;
  readonly bulkDeleteMode?: boolean;
  readonly onBulkDeleteModeChange?: (enabled: boolean) => void;
}

export default function TimelineHeader({
  canBulkDelete,
  bulkDeleteMode,
  onBulkDeleteModeChange,
}: Readonly<TimelineHeaderProps>) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Training
        </h1>
        <p className="text-muted-foreground mt-1">
          Today, upcoming sessions, and recent training.
        </p>
      </div>
      {onBulkDeleteModeChange ? (
        <Button
          type="button"
          variant={bulkDeleteMode ? "secondary" : "outline"}
          onClick={() => onBulkDeleteModeChange(!bulkDeleteMode)}
          disabled={!canBulkDelete && !bulkDeleteMode}
          data-testid="button-bulk-delete-mode"
        >
          {bulkDeleteMode ? (
            <X className="mr-2 h-4 w-4" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          {bulkDeleteMode ? "Done" : "Bulk delete"}
        </Button>
      ) : null}
    </div>
  );
}
