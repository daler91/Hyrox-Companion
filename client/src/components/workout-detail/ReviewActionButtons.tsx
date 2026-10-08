import type { TimelineEntry } from "@shared/schema";
import { Merge, MessageSquare, RotateCcw, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Deleting a completed planned session removes its log and keeps its plan
 * day, which then reads planned again, or missed once its date has passed;
 * the copy said the workout was "permanently removed" as though the session
 * went too. Either way the log goes to the recycle bin, with an Undo, so it
 * isn't permanent. Matches the bulk-delete copy. CL23
 * (CODEBASE_ANALYSIS_2026-10-03)
 */
function deleteConfirmDescription(entry: TimelineEntry): string {
  if (entry.planDayId) {
    return "This removes the logged workout from your timeline. The planned session stays on your plan and shows as planned again, or missed if its date has passed.";
  }
  return "This removes the workout and all of its data from your timeline.";
}

interface ReviewActionButtonsProps {
  readonly entry: TimelineEntry;
  readonly deleteConfirmOpen: boolean;
  readonly currentCoachSeedText: string;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onMarkPlanned?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onCombine?: (entry: TimelineEntry) => void;
  readonly onDeleteConfirmOpenChange: (open: boolean) => void;
  readonly onDeleteConfirm: () => void;
}

/** The review sheet's sticky footer: ask coach, reopen, combine and delete. */
export function ReviewActionButtons({
  entry,
  deleteConfirmOpen,
  currentCoachSeedText,
  onAskCoach,
  onMarkPlanned,
  onDelete,
  onCombine,
  onDeleteConfirmOpenChange,
  onDeleteConfirm,
}: ReviewActionButtonsProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        {onAskCoach ? (
          <Button
            type="button"
            className="flex-1"
            onClick={() => onAskCoach(entry, currentCoachSeedText)}
            data-testid={`review-ask-coach-${entry.id}`}
          >
            <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
            Ask coach
          </Button>
        ) : null}
        {onMarkPlanned && entry.planDayId ? (
          <Button
            type="button"
            variant="outline"
            className={onAskCoach ? undefined : "flex-1"}
            onClick={() => onMarkPlanned(entry)}
            data-testid={`review-mark-planned-${entry.id}`}
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reopen
          </Button>
        ) : null}
        {onCombine ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => {
                    onCombine(entry);
                  }}
                  aria-label="Combine with another workout"
                  data-testid={`review-combine-${entry.id}`}
                >
                  <Merge className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Combine with another workout</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        {onDelete ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onDeleteConfirmOpenChange(true)}
                  aria-label="Delete workout"
                  data-testid={`review-delete-${entry.id}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete workout</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {onDelete ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={onDeleteConfirmOpenChange}
          title="Delete workout?"
          description={deleteConfirmDescription(entry)}
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={onDeleteConfirm}
          isDestructive
          cancelTestId={`review-cancel-delete-${entry.id}`}
          confirmTestId={`review-confirm-delete-${entry.id}`}
        />
      ) : null}
    </>
  );
}
