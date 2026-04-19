import type { TimelineEntry } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WorkoutDetailHeaderV2Props {
  readonly entry: TimelineEntry;
  readonly onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  completed: "Completed",
  missed: "Missed",
  skipped: "Skipped",
};

/**
 * Top bar of the v2 dialog — date strip, status chip, "AI modified"
 * affordance when the plan day's coach rationale has been applied, and a
 * close button. Deliberately minimal: the old header stacked status +
 * source + day name; the mockup keeps it to just the date + two chips.
 */
export function WorkoutDetailHeaderV2({ entry, onClose }: WorkoutDetailHeaderV2Props) {
  const dateLabel = formatDateHeader(entry.date);
  const statusLabel = STATUS_LABEL[entry.status] ?? entry.status;
  const aiModified = !!entry.aiSource || !!entry.aiNoteUpdatedAt;

  return (
    <div className="flex items-start justify-between gap-4 pb-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="workout-detail-date">
          <span className="inline-flex items-center gap-1">
            <span>{dateLabel}</span>
          </span>
          <Badge variant="outline" className="font-normal">{statusLabel}</Badge>
          {aiModified && (
            <Badge
              variant="outline"
              className="border-green-500/40 bg-green-500/10 font-normal text-green-700 dark:text-green-400"
              data-testid="ai-modified-chip"
            >
              <Sparkles className="mr-1 size-3" aria-hidden />
              AI modified
            </Badge>
          )}
        </div>
        <h2 className="text-2xl font-semibold leading-tight">{entry.focus || "Workout"}</h2>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close workout details"
        className="shrink-0"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function formatDateHeader(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    return format(d, "EEE · MMM d");
  } catch {
    return dateStr;
  }
}
