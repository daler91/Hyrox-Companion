import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  DAY_NAMES,
  DEFAULT_DAYS_PER_WEEK,
  type ExperienceLevel,
  MAX_DAYS_PER_WEEK,
  MIN_DAYS_PER_WEEK,
} from "./useGeneratePlanForm";

interface GeneratePlanScheduleStepProps {
  readonly daysPerWeek: number;
  readonly onDaysPerWeekChange: (value: number) => void;
  readonly restDays: string[];
  readonly requiredRestDays: number;
  readonly onRestDayToggle: (day: string) => void;
  readonly experienceLevel: ExperienceLevel;
  readonly onExperienceLevelChange: (value: ExperienceLevel) => void;
  readonly startDate: string;
  readonly onStartDateChange: (value: string) => void;
  readonly endDate: string;
  readonly onEndDateChange: (value: string) => void;
  readonly endDateIsRaceDate: boolean;
  readonly onEndDateIsRaceDateChange: (value: boolean) => void;
  readonly planWeeks: number;
  readonly dateError: string | null;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly canProceed: boolean;
}

export function GeneratePlanScheduleStep({
  daysPerWeek,
  onDaysPerWeekChange,
  restDays,
  requiredRestDays,
  onRestDayToggle,
  experienceLevel,
  onExperienceLevelChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  endDateIsRaceDate,
  onEndDateIsRaceDateChange,
  planWeeks,
  dateError,
  onBack,
  onNext,
  canProceed,
}: GeneratePlanScheduleStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="days">Days/Week</Label>
        <Input
          id="days"
          type="number"
          min={MIN_DAYS_PER_WEEK}
          max={MAX_DAYS_PER_WEEK}
          value={daysPerWeek}
          onChange={(event) =>
            onDaysPerWeekChange(Number.parseInt(event.target.value) || DEFAULT_DAYS_PER_WEEK)
          }
        />
      </div>

      {daysPerWeek < 7 && (
        <div className="space-y-2">
          <Label>
            Rest Days{" "}
            <span className="text-muted-foreground font-normal">(select {requiredRestDays})</span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {DAY_NAMES.map((day) => (
              <Button
                key={day}
                variant={restDays.includes(day) ? "default" : "outline"}
                size="sm"
                className="text-xs px-2 py-1 h-7"
                onClick={() => onRestDayToggle(day)}
                aria-pressed={restDays.includes(day)}
                disabled={!restDays.includes(day) && restDays.length >= requiredRestDays}
                type="button"
              >
                {day.slice(0, 3)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Experience Level</Label>
        <Select
          value={experienceLevel}
          onValueChange={(value) => onExperienceLevelChange(value as ExperienceLevel)}
        >
          <SelectTrigger aria-label="Select experience level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="beginner">Beginner</SelectItem>
            <SelectItem value="intermediate">Intermediate</SelectItem>
            <SelectItem value="advanced">Advanced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => onEndDateChange(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="endDateIsRaceDate">This is my race date</Label>
            <p className="text-xs text-muted-foreground">Structures phases to peak on this day.</p>
          </div>
          <Switch
            id="endDateIsRaceDate"
            checked={endDateIsRaceDate}
            onCheckedChange={onEndDateIsRaceDateChange}
          />
        </div>

        {dateError ? (
          <p className="text-xs text-destructive" role="alert">
            {dateError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{planWeeks}-week plan</p>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
