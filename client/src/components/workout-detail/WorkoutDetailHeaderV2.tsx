import type { TimelineEntry, WorkoutStatus } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { CheckCircle2, ChevronDown,Clock, Layers, MoreVertical, SkipForward, Sparkles, Trash2,XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface WorkoutDetailHeaderV2Props {
  readonly entry: TimelineEntry;
  readonly onDelete?: () => void;
  /**
   * Invoked when the user picks a different status from either the status
   * chip dropdown (primary entry point) or the ⋮ overflow menu. Only
   * relevant for entries linked to a plan day — the current status is
   * filtered out so the user never sees a no-op transition.
   */
  readonly onChangeStatus?: (status: WorkoutStatus) => void;
  /** Opens the combine-workouts picker. Only available on logged entries. */
  readonly onCombine?: () => void;
}

interface StatusStyle {
  label: string;
  Icon: typeof CheckCircle2;
  chipClass: string;
  colorClass: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  planned: {
    label: "Planned",
    Icon: Clock,
    chipClass: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    colorClass: "text-blue-600 dark:text-blue-400",
  },
  completed: {
    label: "Completed",
    Icon: CheckCircle2,
    chipClass: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
    colorClass: "text-green-600 dark:text-green-400",
  },
  missed: {
    label: "Missed",
    Icon: XCircle,
    chipClass: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
    colorClass: "text-red-600 dark:text-red-400",
  },
  skipped: {
    label: "Skipped",
    Icon: SkipForward,
    chipClass: "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
    colorClass: "text-yellow-600 dark:text-yellow-400",
  },
};

const STATUS_ORDER: readonly WorkoutStatus[] = ["completed", "planned", "skipped", "missed"];

/**
 * Top bar of the v2 dialog — date strip, clickable status chip, "AI
 * modified" affordance when the plan day's coach rationale has been
 * applied, and an overflow menu (combine + delete). The shadcn
 * DialogContent wrapper already renders its own close X, so this header
 * intentionally omits one.
 */
export function WorkoutDetailHeaderV2({ entry, onDelete, onChangeStatus, onCombine }: WorkoutDetailHeaderV2Props) {
  const dateLabel = formatDateHeader(entry.date);
  const style = STATUS_STYLES[entry.status] ?? {
    label: entry.status,
    Icon: Clock,
    chipClass: "",
    colorClass: "",
  };
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
  const statusOptions: WorkoutStatus[] = canChangeStatus
    ? STATUS_ORDER.filter((status) => {
        if (status === entry.status) return false;
        if (status === "completed" && !entry.workoutLogId) return false;
        return true;
      })
    : [];

  const hasOverflowMenu = !!onDelete || !!onCombine;

  return (
    <div className="flex items-start justify-between gap-4 pb-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="workout-detail-date">
          <span className="inline-flex items-center gap-1">
            <span>{dateLabel}</span>
          </span>
          <StatusChip
            style={style}
            options={statusOptions}
            onChangeStatus={onChangeStatus}
          />
          {aiModified && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-normal text-green-700 dark:text-green-400"
              data-testid="ai-modified-chip"
            >
              <Sparkles className="size-3" aria-hidden />
              AI modified
            </span>
          )}
        </div>
        <h2 className="text-2xl font-semibold leading-tight">{entry.focus || "Workout"}</h2>
      </div>
      {hasOverflowMenu && (
        <div className="flex shrink-0 items-center gap-1">
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
              {onCombine && (
                <DropdownMenuItem onSelect={onCombine} data-testid="workout-detail-combine">
                  <Layers className="mr-2 size-4" aria-hidden /> Combine workouts
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  {onCombine && <DropdownMenuSeparator />}
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
        </div>
      )}
    </div>
  );
}

interface StatusChipProps {
  readonly style: StatusStyle;
  readonly options: WorkoutStatus[];
  readonly onChangeStatus?: (status: WorkoutStatus) => void;
}

/**
 * Clickable status chip — the primary entry point for flipping a plan
 * day's status. For entries that can't change status (no plan day
 * linked, or no handler wired) this falls back to a non-interactive
 * pill so the status label is still visible.
 */
function StatusChip({ style, options, onChangeStatus }: Readonly<StatusChipProps>) {
  const canChange = !!onChangeStatus && options.length > 0;
  const baseClass = cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-normal",
    style.chipClass,
  );

  if (!canChange) {
    return (
      <span className={baseClass} data-testid="workout-detail-status-chip">
        <style.Icon className="size-3" aria-hidden />
        {style.label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(baseClass, "cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          aria-label={`Change status from ${style.label}`}
          data-testid="workout-detail-status-chip"
        >
          <style.Icon className="size-3" aria-hidden />
          {style.label}
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((status) => {
          const opt = STATUS_STYLES[status];
          if (!opt) return null;
          const Icon = opt.Icon;
          return (
            <DropdownMenuItem
              key={status}
              onSelect={() => onChangeStatus?.(status)}
              className={opt.colorClass}
              data-testid={`workout-detail-status-${status}`}
            >
              <Icon className="mr-2 size-4" aria-hidden /> {opt.label.startsWith("Mark") ? opt.label : `Mark as ${opt.label.toLowerCase()}`}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
