import { useDroppable } from "@dnd-kit/core";
import type { PersonalRecord,TimelineAnnotation, TimelineEntry } from "@shared/schema";
import { format, isBefore,isToday, isTomorrow, isYesterday, parseISO } from "date-fns";
import { StickyNote } from "lucide-react";
import React, { forwardRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import TimelineWorkoutCard from "./timeline-workout-card";
import { TimelineAnnotationCard } from "./TimelineAnnotationCard";

interface TimelineDateGroupProps {
  date: string;
  entries: TimelineEntry[];
  annotations?: TimelineAnnotation[];
  onMarkComplete: (entry: TimelineEntry) => void;
  onClick: (entry: TimelineEntry) => void;
  onCombineSelect?: (entry: TimelineEntry) => void;
  isCombining?: boolean;
  combiningEntryId?: string | null;
  combiningEntryDate?: string | null;
  personalRecords?: Record<string, PersonalRecord>;
  isAutoCoaching?: boolean;
  onAddAnnotation?: (date: string) => void;
  onEditAnnotation?: (annotation: TimelineAnnotation) => void;
  onDeleteAnnotation?: (id: string) => void;
  isAnnotationDeleting?: boolean;
  onMoveEntry?: (entry: TimelineEntry, newDate: string) => void;
  isMovingEntry?: boolean;
}

function getDateLabel(dateObj: Date) {
  if (isToday(dateObj)) return "Today";
  if (isTomorrow(dateObj)) return "Tomorrow";
  if (isYesterday(dateObj)) return "Yesterday";
  return format(dateObj, "EEEE, MMM d");
}


function getDotColor(isTodayDate: boolean, isPast: boolean) {
  if (isTodayDate) return "bg-primary";
  if (isPast) return "bg-muted-foreground/30";
  return "bg-muted-foreground/50";
}

const TimelineDateGroupComponent = forwardRef<HTMLDivElement, TimelineDateGroupProps>(
  (
    {
      date,
      entries,
      annotations,
      onMarkComplete,
      onClick,
      onCombineSelect,
      isCombining,
      combiningEntryId,
      combiningEntryDate,
      personalRecords,
      isAutoCoaching,
      onAddAnnotation,
      onEditAnnotation,
      onDeleteAnnotation,
      isAnnotationDeleting,
      onMoveEntry,
      isMovingEntry,
    },
    ref,
  ) => {
    const dateObj = parseISO(date);
    const isTodayDate = isToday(dateObj);
    const isPast = isBefore(dateObj, new Date()) && !isTodayDate;
    const hasAnnotations = (annotations?.length ?? 0) > 0;

    // Register as a drop target so a draggable timeline card can be released
    // on the date heading or the space below its entries. `data.date` is
    // read back in the DndContext's onDragEnd handler to fire the move.
    const { setNodeRef: setDropNodeRef, isOver, active } = useDroppable({
      id: `timeline-date:${date}`,
      data: { date },
    });

    // The card itself knows its origin date (entry.data.entry.date) — we
    // only want to highlight drop targets that would actually change the
    // date, not the group the card came from.
    const activeEntryDate =
      (active?.data?.current as { entry?: { date?: string } } | undefined)?.entry?.date;
    const isDropTarget = isOver && activeEntryDate && activeEntryDate !== date;

    // Defensive: an empty date group with no annotations should not render a
    // visible row. Step 1 of the annotation wiring (useTimelineFilters) only
    // creates empty groups for annotation start dates, so this is a guard
    // against future regressions.
    if (entries.length === 0 && !hasAnnotations) {
      return null;
    }

    // Hover-revealed on desktop, always-visible below md so touch users see
    // it without needing a hover event. The today row always shows the
    // chip, regardless of breakpoint — that's the primary discoverable
    // entry point for new users who have not yet created any annotations.
    const addNoteClassName = isTodayDate
      ? ""
      : "opacity-100 md:opacity-0 md:group-hover/date:opacity-100 transition-opacity";

    const composedRef = (node: HTMLDivElement | null) => {
      setDropNodeRef(node);
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    return (
      <div
        className={cn(
          "relative pb-4 group/date rounded-md transition-colors",
          isDropTarget && "bg-primary/10 outline outline-2 outline-dashed outline-primary/50",
        )}
        ref={composedRef}
        data-testid={`timeline-date-group-${date}`}
      >
        {isTodayDate && (
          <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full" />
        )}
        <div
          className={`flex items-center gap-3 mb-3 py-2 ${
            isTodayDate ? "text-primary font-semibold" : ""
          }`}
        >
          <div
            className={`h-3 w-3 rounded-full ${getDotColor(isTodayDate, isPast)}`}
          />
          <span className={isTodayDate ? "" : "text-muted-foreground"}>
            {getDateLabel(dateObj)}
          </span>
          {entries[0]?.weekNumber && (
            <Badge variant="outline" className="ml-auto">
              Week {entries[0].weekNumber}
            </Badge>
          )}
          {onAddAnnotation ? (
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs text-muted-foreground hover:text-foreground ${
                entries[0]?.weekNumber ? "ml-1" : "ml-auto"
              } ${addNoteClassName}`}
              onClick={() => onAddAnnotation(date)}
              aria-label={`Log a note for ${getDateLabel(dateObj)}`}
              data-testid={`button-add-annotation-${date}`}
            >
              <StickyNote className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Note
            </Button>
          ) : null}
        </div>

        <div className="space-y-2 ml-6">
          {hasAnnotations && onEditAnnotation && onDeleteAnnotation
            ? annotations?.map((annotation) => (
                <TimelineAnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onEdit={onEditAnnotation}
                  onDelete={onDeleteAnnotation}
                  isDeleting={isAnnotationDeleting}
                />
              ))
            : null}
          {entries.map((entry) => (
            <TimelineWorkoutCard
              key={entry.id}
              entry={entry}
              onMarkComplete={onMarkComplete}
              onClick={onClick}
              onCombineSelect={onCombineSelect}
              isCombining={isCombining}
              combiningEntryId={combiningEntryId}
              combiningEntryDate={combiningEntryDate}
              personalRecords={personalRecords}
              isAutoCoaching={isAutoCoaching}
              onMove={onMoveEntry}
              isMoving={isMovingEntry}
            />
          ))}
        </div>
      </div>
    );
  }
);

TimelineDateGroupComponent.displayName = "TimelineDateGroup";

const TimelineDateGroup = React.memo(TimelineDateGroupComponent);
// ⚡ Bolt Performance Optimization:
// Wrap TimelineDateGroup in React.memo so that each date section doesnt re-render
// when other parts of the timeline change (unless its own props change).
export default TimelineDateGroup;
