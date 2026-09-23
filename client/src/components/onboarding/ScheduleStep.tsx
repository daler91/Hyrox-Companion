import { format, startOfToday } from "date-fns";
import { CalendarDays, Info } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { weekOneStartNote } from "@/lib/planStart";

interface ScheduleStepProps {
  readonly startDate: Date;
  readonly onStartDateChange: (date: Date) => void;
}

export function ScheduleStep({ startDate, onStartDateChange }: Readonly<ScheduleStepProps>) {
  // Sessions are never placed before this date, so it is the day the plan
  // really starts; a midweek pick says what it leaves off (onboarding audit C3).
  const note = weekOneStartNote(format(startDate, "yyyy-MM-dd"));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        <span>Your plan will start on {format(startDate, "EEEE, MMMM d, yyyy")}</span>
      </div>
      {note && (
        <p
          className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="text-week-one-note"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{note}</span>
        </p>
      )}
      <div className="flex justify-center">
        <Calendar
          mode="single"
          selected={startDate}
          defaultMonth={startDate}
          onSelect={(date) => date && onStartDateChange(date)}
          // Today is a valid start (audit L1); only past days are closed.
          disabled={(date) => date < startOfToday()}
          className="rounded-md border"
          data-testid="calendar-start-date"
        />
      </div>
    </div>
  );
}
