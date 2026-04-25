import type { TimelineEntry, WorkoutStatus } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { CheckCircle2, ChevronDown,Clock, Layers, MoreVertical, SkipForward, Sparkles, Trash2,XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { cn } from "@/lib/utils";

import { type SaveState, SaveStatePill } from "./SaveStatePill";

const TITLE_DEBOUNCE_MS = 350;
const TITLE_MAX_LENGTH = 120;

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
  /**
   * Debounced autosave handler for the workout's title (focus). When
   * omitted the title renders as read-only text. The parent picks the
   * right branch (logged workout vs plan day) and wires the mutation.
   */
  readonly onChangeFocus?: (focus: string) => void;
  /** Drives the "Saving…/Saved" pill shown next to the title. */
  readonly saveState?: SaveState;
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
export function WorkoutDetailHeaderV2({
  entry,
  onDelete,
  onChangeStatus,
  onCombine,
  onChangeFocus,
  saveState,
}: WorkoutDetailHeaderV2Props) {
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
    <div className="flex items-start justify-between gap-4 pb-2 pr-16 sm:pr-20">
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
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs font-normal text-muted-foreground"
              data-testid="ai-modified-chip"
            >
              <Sparkles className="size-3" aria-hidden />
              Coach updated
            </span>
          )}
        </div>
        <EditableFocus
          focus={entry.focus || ""}
          onChange={onChangeFocus}
          saveState={saveState}
        />
      </div>
      {hasOverflowMenu && (
        // top-1.5 centers the 36×36 size-icon Button's 16×16 icon at y=24,
        // matching shadcn's bare-16×16 close X at right-4 top-4.
        <div className="absolute right-12 top-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-touch"
                aria-label="Workout actions"
                className="md:h-9 md:w-9"
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
    "inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-normal",
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

interface EditableFocusProps {
  readonly focus: string;
  readonly onChange?: (next: string) => void;
  readonly saveState?: SaveState;
}

/**
 * Heading-styled inline input for the workout title. Draft state feels
 * immediate; the debounced autosave propagates to the server. `lastExternal`
 * sync lets a timeline refetch overwrite the local draft when the field is
 * genuinely different (e.g. another device updated focus), but suppresses
 * echoes of the user's own just-saved value.
 *
 * Empty/whitespace-only drafts are NOT sent — `plan_days.focus` and
 * `workout_logs.focus` are NOT NULL columns, and the server would reject.
 * The user still sees an empty input; blurring restores the last saved value.
 */
function EditableFocus({ focus, onChange, saveState }: Readonly<EditableFocusProps>) {
  const [draft, setDraft] = useState(focus);
  const [lastExternal, setLastExternal] = useState(focus);
  // Track the latest value we've submitted to the server. Comparing against
  // this rather than the `focus` prop matters because the prop can lag
  // behind recent edits (the timeline query is invalidated, not optimistic):
  // typing A → blur → revert to the original value → prop still shows A,
  // but the revert is a legitimate change the server should see. The ref is
  // synced from a post-commit effect so the next render's handlers see the
  // updated baseline; updating it during render would violate react-hooks.
  const lastSubmittedRef = useRef(focus);
  if (focus !== lastExternal) {
    setLastExternal(focus);
    setDraft(focus);
  }
  useEffect(() => {
    lastSubmittedRef.current = focus;
  }, [focus]);

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    if (trimmed === lastSubmittedRef.current) return;
    lastSubmittedRef.current = trimmed;
    onChange?.(trimmed);
  };

  const debouncedSave = useDebouncedCallback((next: string) => {
    submit(next);
  }, TITLE_DEBOUNCE_MS);

  const handleBlur = () => {
    // Blur fires synchronously before click events, so flushing here closes
    // the 350ms debounce gap for a user who types a new title and
    // immediately clicks Mark complete / Save / any other action. The
    // submitted PATCH then updates plan_day.focus before the completion
    // mutation snapshots it server-side.
    if (draft.trim().length === 0 && focus.length > 0) {
      setDraft(focus);
      return;
    }
    submit(draft);
  };

  const readOnly = !onChange;
  if (readOnly) {
    return (
      <h2 className="text-2xl font-semibold leading-tight" data-testid="workout-detail-focus">
        {focus || "Workout"}
      </h2>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        value={draft}
        maxLength={TITLE_MAX_LENGTH}
        placeholder="Workout"
        aria-label="Workout title"
        onChange={(e) => {
          setDraft(e.target.value);
          debouncedSave(e.target.value);
        }}
        onBlur={handleBlur}
        className={cn(
          "h-auto border-transparent bg-transparent px-2 py-0.5 text-2xl font-semibold leading-tight",
          "shadow-none hover:border-input focus-visible:border-input",
        )}
        data-testid="workout-detail-focus-input"
      />
      {saveState && (
        <SaveStatePill state={saveState} testId="workout-detail-focus-save-state" />
      )}
    </div>
  );
}
