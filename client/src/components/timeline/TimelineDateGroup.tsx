import { forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isTomorrow, isYesterday, parseISO, isBefore } from "date-fns";
import type { TimelineEntry } from "@shared/schema";
import TimelineWorkoutCard from "./TimelineWorkoutCard";

interface TimelineDateGroupProps {
  date: string;
  entries: TimelineEntry[];
  onMarkComplete: (entry: TimelineEntry) => void;
  onEdit: (entry: TimelineEntry) => void;
  onSkip: (entry: TimelineEntry) => void;
}

function getDateLabel(dateObj: Date) {
  if (isToday(dateObj)) return "Today";
  if (isTomorrow(dateObj)) return "Tomorrow";
  if (isYesterday(dateObj)) return "Yesterday";
  return format(dateObj, "EEEE, MMM d");
}

const TimelineDateGroup = forwardRef<HTMLDivElement, TimelineDateGroupProps>(
  ({ date, entries, onMarkComplete, onEdit, onSkip }, ref) => {
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
            className={`h-3 w-3 rounded-full ${
              isTodayDate
                ? "bg-primary"
                : isPast
                ? "bg-muted-foreground/30"
                : "bg-muted-foreground/50"
            }`}
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
              onEdit={onEdit}
              onSkip={onSkip}
            />
          ))}
        </div>
      </div>
    );
  }
);

TimelineDateGroup.displayName = "TimelineDateGroup";

export default TimelineDateGroup;
