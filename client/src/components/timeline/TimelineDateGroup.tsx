import React, { forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isTomorrow, isYesterday, parseISO, isBefore } from "date-fns";
import type { TimelineEntry, PersonalRecord } from "@shared/schema";
import TimelineWorkoutCard from "./TimelineWorkoutCard";

interface TimelineDateGroupProps {
  date: string;
  entries: TimelineEntry[];
  onMarkComplete: (entry: TimelineEntry) => void;
  onClick: (entry: TimelineEntry) => void;
  onCombineSelect?: (entry: TimelineEntry) => void;
  isCombining?: boolean;
  combiningEntryId?: string | null;
  combiningEntryDate?: string | null;
  personalRecords?: Record<string, PersonalRecord>;
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
  ({ date, entries, onMarkComplete, onClick, onCombineSelect, isCombining, combiningEntryId, combiningEntryDate, personalRecords }, ref) => {
    const dateObj = parseISO(date);
    const isTodayDate = isToday(dateObj);
    const isPast = isBefore(dateObj, new Date()) && !isTodayDate;

    return (
      <div className="relative" ref={ref}>
        {isTodayDate && (
          <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full" />
        )}
        <div
          className={`flex items-center gap-3 mb-3 ${
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
        </div>

        <div className="space-y-2 ml-6">
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
