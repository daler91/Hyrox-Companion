import type { TimelineEntry, WorkoutStatus } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Clock, Layers, MoreVertical, SkipForward, Sparkles, Trash2, X,XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkoutDetailHeaderV2Props {
  readonly entry: TimelineEntry;
  readonly onClose: () => void;
  readonly onDelete?: () => void;
  /**
   * Invoked when the user picks a different status from the ⋮ menu. Only
   * relevant for entries linked to a plan day — the current status is
   * filtered out of the menu so the user never sees "Mark as completed"
   * while the workout is already completed.
   */
  readonly onChangeStatus?: (status: WorkoutStatus) => void;
  /** Opens the combine-workouts picker. Only available on logged entries. */
  readonly onCombine?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  completed: "Completed",
  missed: "Missed",
  skipped: "Skipped",
};

/**
 * Ordered once so the menu shows the same items in the same place no
 * matter what the current status is; the current status gets filtered
 * out at render time.
 */
const STATUS_MENU_ITEMS: ReadonlyArray<{
  status: WorkoutStatus;
  label: string;
  Icon: typeof CheckCircle2;
  colorClass: string;
}> = [
  { status: "completed", label: "Mark as completed", Icon: CheckCircle2, colorClass: "text-green-600 dark:text-green-400" },
  { status: "planned", label: "Mark as planned", Icon: Clock, colorClass: "text-blue-600 dark:text-blue-400" },
  { status: "skipped", label: "Mark as skipped", Icon: SkipForward, colorClass: "text-yellow-600 dark:text-yellow-400" },
  { status: "missed", label: "Mark as missed", Icon: XCircle, colorClass: "text-red-600 dark:text-red-400" },
];

/**
 * Top bar of the v2 dialog — date strip, status chip, "AI modified"
 * affordance when the plan day's coach rationale has been applied, an
 * overflow menu (status change + delete), and a close button.
 */
export function WorkoutDetailHeaderV2({ entry, onClose, onDelete, onChangeStatus, onCombine }: WorkoutDetailHeaderV2Props) {
  const dateLabel = formatDateHeader(entry.date);
  const statusLabel = STATUS_LABEL[entry.status] ?? entry.status;
  const aiModified = !!entry.aiSource || !!entry.aiNoteUpdatedAt;

  // Status change is only available for entries linked to a plan day —
  // the underlying updateStatusMutation writes to plan_days, so an
  // ad-hoc logged workout has nothing to flip. We also drop "Mark as
  // completed" for entries that haven't been logged yet: flipping the
  // plan_day status alone would leave status="completed" with no
  // workoutLog, breaking metrics + history. Planned entries take the
  // Mark-complete CTA path instead, which fires logWorkoutMutation to
  // actually create the workoutLog.
  const canChangeStatus = !!onChangeStatus && !!entry.planDayId;
  const statusItems = canChangeStatus
    ? STATUS_MENU_ITEMS.filter((item) => {
        if (item.status === entry.status) return false;
        if (item.status === "completed" && !entry.workoutLogId) return false;
        return true;
      })
    : [];

  const hasMenu = canChangeStatus || !!onDelete || !!onCombine;

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
      <div className="flex shrink-0 items-center gap-1">
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Workout actions"
                data-testid="workout-detail-actions-trigger"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {statusItems.map(({ status, label, Icon, colorClass }) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() => onChangeStatus?.(status)}
                  className={colorClass}
                  data-testid={`workout-detail-status-${status}`}
                >
                  <Icon className="mr-2 size-4" aria-hidden /> {label}
                </DropdownMenuItem>
              ))}
              {onCombine && (
                <>
                  {statusItems.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onSelect={onCombine}
                    data-testid="workout-detail-combine"
                  >
                    <Layers className="mr-2 size-4" aria-hidden /> Combine workouts
                  </DropdownMenuItem>
                </>
              )}
              {onDelete && (
                <>
                  {(statusItems.length > 0 || onCombine) && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onSelect={onDelete}
                    className="text-destructive"
                    data-testid="workout-detail-delete"
                  >
                    <Trash2 className="mr-2 size-4" aria-hidden /> Delete workout
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close workout details"
        >
          <X className="size-4" />
        </Button>
      </div>
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
