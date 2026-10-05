import type { useDraggable } from "@dnd-kit/core";
import { addDays, format, isValid, parseISO } from "date-fns";
import { CalendarClock, Move } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { TimelineWorkoutCardProps } from "./types";

/**
 * The earliest date the picker will commit. A year typed digit by digit
 * passes through 0002, 0020 and 0202, and the server accepts all of them;
 * no training session belongs there. CL11 (CODEBASE_ANALYSIS_2026-10-03)
 */
const MIN_MOVE_DATE = "2000-01-01";

/**
 * Whether the picker's value is a date worth moving to: a complete calendar
 * date (a half-typed one reads as ""), inside the allowed window, and not the
 * day the session is already on.
 */
function isCommittableMoveDate(
  value: string,
  currentDate: string,
  maxDate: string | undefined,
): boolean {
  if (value.length !== 10 || !isValid(parseISO(value))) return false;
  if (value === currentDate || value < MIN_MOVE_DATE) return false;
  return maxDate === undefined || value <= maxDate;
}

interface MoveEntryMenuProps {
  readonly entry: TimelineWorkoutCardProps["entry"];
  readonly isMoving: boolean | undefined;
  readonly isDragging: boolean;
  readonly movePickerOpen: boolean;
  readonly setMovePickerOpen: (open: boolean) => void;
  readonly onMove: (newDate: string) => void;
  readonly dragListeners: ReturnType<typeof useDraggable>["listeners"];
  readonly dragAttributes: ReturnType<typeof useDraggable>["attributes"];
}

/**
 * Top-right affordance cluster on a timeline card:
 *  - Drag handle (⋮⋮) to pick up the card and drop it on a date row.
 *  - Overflow menu with quick jumps (today / tomorrow / +7d) and a
 *    "Pick date…" dialog for arbitrary dates outside the visible window.
 *
 * Both paths funnel through the parent's `onMove` handler, which wraps the
 * reschedule mutation and optimistic timeline update. Buttons stop click
 * propagation so tapping them doesn't also open the workout detail dialog.
 */
export function MoveEntryMenu({
  entry,
  isMoving,
  isDragging,
  movePickerOpen,
  setMovePickerOpen,
  onMove,
  dragListeners,
  dragAttributes,
}: Readonly<MoveEntryMenuProps>) {
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const tomorrowIso = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const nextWeekIso = format(addDays(new Date(), 7), "yyyy-MM-dd");

  // Workout-log moves route through PATCH /api/v1/workouts/:id, whose
  // `updateWorkoutLogSchema` rejects dates more than 24h in the future
  // (see `workoutDateNotFuture` in shared/schema/types/workouts.ts). Clamp the
  // menu to the allowed window so we don't offer taps that would
  // deterministically produce validation-error toasts. Plan-day-only
  // moves have no such server constraint.
  const isLoggedMove = Boolean(entry.workoutLogId);
  const maxDate = isLoggedMove ? tomorrowIso : undefined;
  const showNextWeek = !isLoggedMove && entry.date !== nextWeekIso;

  // Stop mousedown + click on each interactive surface so tapping a
  // control doesn't also fire the Card's onClick (open detail) via
  // React's synthetic event system. React events bubble through the
  // component tree even across portals, so DropdownMenu / Popover
  // content still propagate to the Card unless we stop them at each
  // interactive surface. We attach to native buttons and to the
  // Radix *Content components (which are semantic, not presentational
  // divs — satisfying the sonar a11y rule against interactive
  // wrapper `<div>`s).
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="absolute right-2 top-2 z-10 flex items-center gap-0.5 transition-opacity md:opacity-60 md:hover:opacity-100 md:focus-within:opacity-100"
      data-testid={`move-entry-controls-${entry.id}`}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 w-9 md:h-7 md:w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground touch-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isDragging && "cursor-grabbing text-primary",
                !isDragging && "cursor-grab",
              )}
              aria-label={`Drag ${entry.focus || "workout"} to another day`}
              data-testid={`drag-handle-${entry.id}`}
              onClick={stop}
              onMouseDown={stop}
              {...dragListeners}
              {...dragAttributes}
            >
              <Move className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Drag to reschedule</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <MoveMenuTrigger entry={entry} isMoving={isMoving} stop={stop} />
        <DropdownMenuContent align="end" onClick={stop} onMouseDown={stop}>
          {entry.date !== todayIso && (
            <DropdownMenuItem
              onSelect={() => {
                onMove(todayIso);
              }}
              data-testid={`move-today-${entry.id}`}
            >
              Move to today
            </DropdownMenuItem>
          )}
          {entry.date !== tomorrowIso && (
            <DropdownMenuItem
              onSelect={() => {
                onMove(tomorrowIso);
              }}
              data-testid={`move-tomorrow-${entry.id}`}
            >
              Move to tomorrow
            </DropdownMenuItem>
          )}
          {showNextWeek && (
            <DropdownMenuItem
              onSelect={() => {
                onMove(nextWeekIso);
              }}
              data-testid={`move-next-week-${entry.id}`}
            >
              Move to next week
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setMovePickerOpen(true);
            }}
            data-testid={`move-pick-date-${entry.id}`}
          >
            Pick date…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={movePickerOpen} onOpenChange={setMovePickerOpen}>
        <DialogContent
          className="sm:max-w-xs"
          onClick={stop}
          onMouseDown={stop}
          data-testid={`move-date-dialog-${entry.id}`}
        >
          <DialogHeader>
            <DialogTitle>Pick a new date</DialogTitle>
            <DialogDescription className="sr-only">
              Choose a new date for this workout
            </DialogDescription>
          </DialogHeader>
          {/* Rendered inside the content, so it unmounts on close and the
              next open starts again from the session's own date. */}
          <MoveDateForm
            entry={entry}
            maxDate={maxDate}
            onMove={onMove}
            onDone={() => {
              setMovePickerOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface MoveMenuTriggerProps {
  readonly entry: TimelineWorkoutCardProps["entry"];
  readonly isMoving: boolean | undefined;
  readonly stop: (e: React.SyntheticEvent) => void;
}

/** The overflow menu's calendar button and its tooltip; rendered inside the menu's `DropdownMenu`. */
function MoveMenuTrigger({ entry, isMoving, stop }: Readonly<MoveMenuTriggerProps>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 md:h-7 md:w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Move ${entry.focus || "workout"} to another day`}
              data-testid={`move-menu-${entry.id}`}
              disabled={isMoving}
              onClick={stop}
              onMouseDown={stop}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Move to another day</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface MoveDateFormProps {
  readonly entry: TimelineWorkoutCardProps["entry"];
  readonly maxDate: string | undefined;
  readonly onMove: (newDate: string) => void;
  readonly onDone: () => void;
}

/**
 * The picker only records the date while it is being chosen; the move waits
 * for "Move" (or Enter). A desktop date input fires change on every keystroke
 * and arrow press, so committing from onChange moved the session on the
 * first digit of the year, with no undo. CL11 (CODEBASE_ANALYSIS_2026-10-03)
 */
function MoveDateForm({ entry, maxDate, onMove, onDone }: Readonly<MoveDateFormProps>) {
  const [pendingDate, setPendingDate] = useState(entry.date);
  const canConfirm = isCommittableMoveDate(pendingDate, entry.date, maxDate);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canConfirm) return;
    onMove(pendingDate);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        type="date"
        defaultValue={entry.date}
        min={MIN_MOVE_DATE}
        max={maxDate}
        onChange={(e) => {
          setPendingDate(e.target.value);
        }}
        data-testid={`move-date-input-${entry.id}`}
        aria-label="New workout date"
      />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canConfirm} data-testid={`move-date-confirm-${entry.id}`}>
          Move
        </Button>
      </DialogFooter>
    </form>
  );
}
