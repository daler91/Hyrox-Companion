import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";

interface ScheduleStepProps {
  readonly startDate: Date;
  readonly onStartDateChange: (date: Date) => void;
}

export function ScheduleStep({ startDate, onStartDateChange }: Readonly<ScheduleStepProps>) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <CalendarDays className="h-4 w-4" />
        <span>Your plan will start on {format(startDate, "EEEE, MMMM d, yyyy")}</span>
      </div>
      <div className="flex justify-center">
        <Calendar
          mode="single"
          selected={startDate}
          onSelect={(date) => date && onStartDateChange(date)}
          disabled={(date) => date < new Date()}
          className="rounded-md border"
          data-testid="calendar-start-date"
        />
      </div>
    </div>
  );
}
