import { useDraggable } from "@dnd-kit/core";
import { addDays, format } from "date-fns";
import { BookOpen, CalendarClock, CheckCircle2, Circle, Database, FileText,Loader2, Move } from "lucide-react";
import React, { useMemo, useState } from "react";

import { StravaIcon } from "@/components/icons/StravaIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

import { CoachNote } from "./CoachNote";
import { ExerciseChips } from "./ExerciseChips";
import type { TimelineWorkoutCardProps } from "./types";
import { getCardClasses,getStatusBadge } from "./utils";
import { WorkoutStravaStats } from "./WorkoutStravaStats";

const TimelineWorkoutCard = React.memo(function TimelineWorkoutCard({
  entry,
  onMarkComplete,
  onClick,
  onCombineSelect,
  isCombining,
  combiningEntryId,
  combiningEntryDate,
  personalRecords,
  isAutoCoaching,
  onMove,
  isMoving,
}: Readonly<TimelineWorkoutCardProps>) {
  const { distanceUnit, weightLabel, showAdherenceInsights } = useUnitPreferences();
  const [movePickerOpen, setMovePickerOpen] = useState(false);

  const isBeingCombined = combiningEntryId === entry.id;
  const isSameDate = combiningEntryDate === entry.date;
  const canBeCombinedWith = isCombining && !isBeingCombined && isSameDate;
  const isPlanned = entry.status === "planned" && entry.planDayId;
  const adherenceBadge = showAdherenceInsights
    ? getAdherenceBadge(entry.compliancePct ?? null)
    : null;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isTargetedByCoach = isAutoCoaching && isPlanned && entry.date >= todayStr;

  // We only allow moving entries that have a stable anchor — either a plan
  // day (reschedule prescription) or a workout log (change date). Ad-hoc
  // rows without either (e.g. header placeholders) can't be moved.
  const canMove = Boolean(onMove) && (entry.planDayId || entry.workoutLogId) && !isCombining;

  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragNodeRef,
    isDragging,
  } = useDraggable({
    id: `timeline-entry:${entry.id}`,
    disabled: !canMove,
    data: { entry },
  });

  const handleCardClick = (_e: React.MouseEvent) => {
    if (canBeCombinedWith) {
      onCombineSelect?.(entry);
    } else {
      onClick(entry);
    }
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (canBeCombinedWith) {
        onCombineSelect?.(entry);
      } else {
        onClick(entry);
      }
    }
  };

  const handleCompleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMarkComplete(entry);
  };

  // ⚡ Bolt Performance Optimization:
  // Memoizing the parsed/grouped exercise sets prevents recalculating the sorting
  // and grouping on every re-render (e.g. when expanding panels or scrolling),
  // which is an O(n log n) operation when sortOrder exists.
  const groupedExercises = useMemo(() => {
    if (!entry.exerciseSets || entry.exerciseSets.length === 0) return [];
    return groupExerciseSets(entry.exerciseSets);
  }, [entry.exerciseSets]);

  const baseCardClasses = getCardClasses(isBeingCombined, canBeCombinedWith, entry.status);
  const aiCoachClasses = isTargetedByCoach
    ? "border-primary/60 bg-primary/5 shadow-md shadow-primary/20 transition-all duration-700 relative"
    : "";
  const dragClasses = cn(
    isDragging && "opacity-50 ring-2 ring-primary/60",
    isMoving && "opacity-70",
  );

  const handleMoveSelect = (newDate: string) => {
    if (!onMove) return;
    onMove(entry, newDate);
  };

  return (
    <Card
      ref={setDragNodeRef}
      className={cn(
        "cursor-pointer transition-colors hover-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        baseCardClasses,
        aiCoachClasses,
        dragClasses,
      )}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      // Label uses only the visible focus + status badge text (date sits in
      // the parent date-group heading) so the accessible name matches what
      // the user can read on screen — WCAG 2.5.3 Label in Name.
      aria-label={`${entry.focus || "Workout"}, ${entry.status}`}
      data-testid={`card-timeline-entry-${entry.id}`}
    >
      {isTargetedByCoach && (
        <Badge
          variant="outline"
          className="absolute -top-3 -right-3 z-30 border-primary border-2 text-primary bg-background shadow-lg shadow-primary/30 animate-pulse px-3 py-1 text-xs font-bold"
          data-testid={`badge-ai-coach-${entry.id}`}
        >
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          AI Modifying
        </Badge>
      )}
      <CardContent className="p-4 relative">
        {canMove && (
          <MoveEntryMenu
            entry={entry}
            isMoving={isMoving}
            isDragging={isDragging}
            movePickerOpen={movePickerOpen}
            setMovePickerOpen={setMovePickerOpen}
            onMove={handleMoveSelect}
            dragListeners={dragListeners}
            dragAttributes={dragAttributes}
          />
        )}
        <div className="flex items-start gap-3">
          {isPlanned && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 mt-0.5 text-muted-foreground hover:text-success"
                    onClick={handleCompleteClick}
                    data-testid={`button-complete-${entry.id}`}
                    aria-label={`Mark ${entry.focus} as complete`}
                  >
                    <Circle className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Mark {entry.focus} as complete</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {entry.status === "completed" && (
            <div className="shrink-0 mt-0.5 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className={cn("flex items-center gap-2 mb-2 flex-wrap", canMove && "pr-16")}>
              {getStatusBadge(entry.status)}
              {isTargetedByCoach && (
                <Badge
                  variant="outline"
                  className="border-primary text-primary bg-primary/5 animate-pulse"
                  data-testid={`badge-ai-coach-${entry.id}`}
                >
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  AI Modifying
                </Badge>
              )}
              {entry.source === "strava" && (
                <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                  <StravaIcon className="h-3 w-3 mr-1" />
                  Strava
                </Badge>
              )}
              {entry.planName && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground"
                  data-testid={`badge-plan-${entry.id}`}
                >
                  <BookOpen className="h-3 w-3 mr-1" />
                  {entry.planName}
                </Badge>
              )}
              {entry.dayName && <Badge variant="secondary">{entry.dayName}</Badge>}
              {adherenceBadge && (
                <Badge
                  variant="outline"
                  className={adherenceBadge.className}
                  data-testid={`badge-adherence-${entry.id}`}
                >
                  {adherenceBadge.label}
                </Badge>
              )}
              {entry.aiSource === "rag" && (
                <Badge
                  variant="outline"
                  className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950 text-[10px]"
                >
                  <Database className="h-2.5 w-2.5 mr-1" />
                  RAG
                </Badge>
              )}
              {entry.aiSource === "legacy" && (
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950 text-[10px]"
                >
                  <FileText className="h-2.5 w-2.5 mr-1" />
                  Legacy
                </Badge>
              )}
              <span className="font-medium">{entry.focus}</span>
            </div>
            {entry.exerciseSets && entry.exerciseSets.length > 0 ? (
              <ExerciseChips
                entryId={entry.id}
                groupedExercises={groupedExercises}
                workoutLogId={entry.workoutLogId ?? undefined}
                personalRecords={personalRecords}
                weightLabel={weightLabel}
                distanceUnit={distanceUnit}
              />
            ) : (
              <p className="text-sm text-muted-foreground mb-1">{entry.mainWorkout}</p>
            )}
            {entry.accessory && (
              <p className="text-sm text-muted-foreground/70 mb-1">{entry.accessory}</p>
            )}
            {entry.notes && (
              <p className="text-xs text-muted-foreground italic mt-2">{entry.notes}</p>
            )}
            {(entry.duration || entry.rpe) && entry.source !== "strava" && (
              <p className="text-xs text-muted-foreground mt-1">
                {[
                  entry.duration ? `Duration: ${entry.duration} min` : null,
                  entry.rpe ? `RPE: ${entry.rpe}` : null,
                ].filter(Boolean).join(" | ")}
              </p>
            )}
            <WorkoutStravaStats entry={entry} distanceUnit={distanceUnit} />
            {entry.aiRationale && (
              <CoachNote
                entryId={entry.id}
                rationale={entry.aiRationale}
                source={entry.aiSource ?? null}
                updatedAt={entry.aiNoteUpdatedAt}
                inputsUsed={entry.aiInputsUsed}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

// ⚡ Bolt Performance Optimization:
// Wrap TimelineWorkoutCard in React.memo so the cards aren't re-rendered when
// parent timeline component state changes (unless their specific entry/props change).
// This reduces unnecessary re-renders in a potentially long list.
export default TimelineWorkoutCard;

function getAdherenceBadge(compliancePct: number | null): { label: string; className: string } | null {
  if (compliancePct == null) return null;
  if (compliancePct >= 85) {
    return {
      label: `Adherence ${compliancePct}%`,
      className: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950",
    };
  }
  if (compliancePct >= 60) {
    return {
      label: `Adherence ${compliancePct}%`,
      className: "border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950",
    };
  }
  return {
    label: `Adherence ${compliancePct}%`,
    className: "border-rose-300 text-rose-700 bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:bg-rose-950",
  };
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
 *    "Pick date…" popover for arbitrary dates outside the visible window.
 *
 * Both paths funnel through the parent's `onMove` handler, which wraps the
 * reschedule mutation and optimistic timeline update. Buttons stop click
 * propagation so tapping them doesn't also open the workout detail dialog.
 */
function MoveEntryMenu({
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
  // (see `workoutDateNotFuture` in shared/schema/types.ts). Clamp the
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
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="absolute right-2 top-2 z-10 flex items-center gap-0.5 opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity"
      data-testid={`move-entry-controls-${entry.id}`}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground touch-none",
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
              <Move className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Drag to reschedule</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Move ${entry.focus || "workout"} to another day`}
            data-testid={`move-menu-${entry.id}`}
            disabled={isMoving}
            onClick={stop}
            onMouseDown={stop}
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop} onMouseDown={stop}>
          {entry.date !== todayIso && (
            <DropdownMenuItem
              onSelect={() => onMove(todayIso)}
              data-testid={`move-today-${entry.id}`}
            >
              Move to today
            </DropdownMenuItem>
          )}
          {entry.date !== tomorrowIso && (
            <DropdownMenuItem
              onSelect={() => onMove(tomorrowIso)}
              data-testid={`move-tomorrow-${entry.id}`}
            >
              Move to tomorrow
            </DropdownMenuItem>
          )}
          {showNextWeek && (
            <DropdownMenuItem
              onSelect={() => onMove(nextWeekIso)}
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
          </DialogHeader>
          <Input
            type="date"
            defaultValue={entry.date}
            max={maxDate}
            onChange={(e) => {
              const next = e.target.value;
              if (!next || next === entry.date) return;
              onMove(next);
              setMovePickerOpen(false);
            }}
            data-testid={`move-date-input-${entry.id}`}
            aria-label="New workout date"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
