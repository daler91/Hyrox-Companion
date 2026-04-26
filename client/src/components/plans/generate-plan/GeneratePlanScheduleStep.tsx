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

import {
  DAY_NAMES,
  DEFAULT_DAYS_PER_WEEK,
  DEFAULT_WEEKS,
  MAX_DAYS_PER_WEEK,
  MAX_WEEKS,
  MIN_DAYS_PER_WEEK,
  MIN_WEEKS,
} from "./useGeneratePlanForm";

interface GeneratePlanScheduleStepProps {
  readonly totalWeeks: number;
  readonly onTotalWeeksChange: (value: number) => void;
  readonly daysPerWeek: number;
  readonly onDaysPerWeekChange: (value: number) => void;
  readonly restDays: string[];
  readonly requiredRestDays: number;
  readonly onRestDayToggle: (day: string) => void;
  readonly experienceLevel: "beginner" | "intermediate" | "advanced";
  readonly onExperienceLevelChange: (value: "beginner" | "intermediate" | "advanced") => void;
  readonly startDate: string;
  readonly onStartDateChange: (value: string) => void;
  readonly raceDate: string;
  readonly onRaceDateChange: (value: string) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}

export function GeneratePlanScheduleStep({
  totalWeeks,
  onTotalWeeksChange,
  daysPerWeek,
  onDaysPerWeekChange,
  restDays,
  requiredRestDays,
  onRestDayToggle,
  experienceLevel,
  onExperienceLevelChange,
  startDate,
  onStartDateChange,
  raceDate,
  onRaceDateChange,
  onBack,
  onNext,
}: GeneratePlanScheduleStepProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="weeks">Weeks</Label>
          <Input
            id="weeks"
            type="number"
            min={MIN_WEEKS}
            max={MAX_WEEKS}
            value={totalWeeks}
            onChange={(event) =>
              onTotalWeeksChange(
                Math.min(
                  MAX_WEEKS,
                  Math.max(MIN_WEEKS, Number.parseInt(event.target.value) || DEFAULT_WEEKS),
                ),
              )
            }
          />
        </div>
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
          onValueChange={(value) =>
            onExperienceLevelChange(value as "beginner" | "intermediate" | "advanced")
          }
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
          <Label htmlFor="raceDate">Race Date</Label>
          <Input
            id="raceDate"
            type="date"
            value={raceDate}
            onChange={(event) => onRaceDateChange(event.target.value)}
          />
        </div>
        <p className="col-span-2 text-xs text-muted-foreground -mt-2">
          Both optional. Race date structures phases to peak on that day.
        </p>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
