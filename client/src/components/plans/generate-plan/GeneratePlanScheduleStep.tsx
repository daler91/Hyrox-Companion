import type { TrainingPlan } from "@shared/schema";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

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
import { aiWeekOneStartNote } from "@/lib/planStart";

import {
  DAY_NAMES,
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
  readonly overlappingPlans: readonly TrainingPlan[];
  readonly supersedePlanIds: readonly string[];
  readonly onToggleSupersede: (planId: string) => void;
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
  overlappingPlans,
  supersedePlanIds,
  onToggleSupersede,
  onBack,
  onNext,
  canProceed,
}: GeneratePlanScheduleStepProps) {
  // A midweek start is fine for an AI plan (it is told and plans rest before
  // it), but say what happens to week 1 (onboarding audit C3).
  const weekOneNote = startDate ? aiWeekOneStartNote(startDate) : null;
  // Points the disabled Next button at whichever rendered hint explains the
  // block (the date error and the rest-day hint render under the same
  // conditions these ids are chosen under).
  let nextBlockedHintId: string | undefined;
  if (!canProceed && dateError) {
    nextBlockedHintId = "schedule-date-error";
  } else if (!canProceed && requiredRestDays > 0) {
    nextBlockedHintId = "schedule-rest-hint";
  }

  return (
    <div className="space-y-4">
      <DaysPerWeekField value={daysPerWeek} onChange={onDaysPerWeekChange} />

      {daysPerWeek < 7 && (
        <fieldset className="space-y-2 border-0 m-0 p-0">
          <legend className="text-sm font-medium leading-none">
            Rest Days{" "}
            <span className="text-muted-foreground font-normal">(select {requiredRestDays})</span>
          </legend>
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
        </fieldset>
      )}

      <div className="space-y-2">
        <Label htmlFor="experience-level">Experience Level</Label>
        <Select
          value={experienceLevel}
          onValueChange={(value) => onExperienceLevelChange(value as ExperienceLevel)}
        >
          <SelectTrigger id="experience-level" aria-label="Select experience level">
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
              aria-describedby={weekOneNote ? "startDate-note" : undefined}
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

        {weekOneNote && (
          <p id="startDate-note" className="text-xs text-muted-foreground" data-testid="text-ai-week-one-note">
            {weekOneNote}
          </p>
        )}

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
          <p id="schedule-date-error" className="text-xs text-destructive" role="alert">
            {dateError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{planWeeks}-week plan</p>
        )}
      </div>

      {overlappingPlans.length > 0 && (
        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">
            {overlappingPlans.length === 1
              ? "You're already on a plan"
              : "You're already on other plans"}
          </legend>
          <p className="text-xs text-muted-foreground">
            Archiving stops the remaining sessions counting towards your adherence. Everything
            you have already logged is kept.
          </p>
          {overlappingPlans.map((plan) => (
            <div key={plan.id} className="flex items-center justify-between gap-3">
              <Label htmlFor={`supersede-${plan.id}`} className="text-sm font-normal">
                Archive <span className="font-medium">{plan.name}</span>
                {plan.endDate ? (
                  <span className="text-muted-foreground"> (runs to {plan.endDate})</span>
                ) : null}
              </Label>
              <Switch
                id={`supersede-${plan.id}`}
                checked={supersedePlanIds.includes(plan.id)}
                onCheckedChange={() => onToggleSupersede(plan.id)}
                data-testid={`switch-supersede-${plan.id}`}
              />
            </div>
          ))}
        </fieldset>
      )}

      {!canProceed && !dateError && requiredRestDays > 0 && (
        <output id="schedule-rest-hint" className="block text-center text-xs text-muted-foreground">
          Select {requiredRestDays - restDays.length} more rest day
          {requiredRestDays - restDays.length !== 1 ? "s" : ""} to continue.
        </output>
      )}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed} aria-describedby={nextBlockedHintId}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** The typed text as a days-per-week count, or null when it isn't one yet. */
function parseDaysPerWeek(raw: string): number | null {
  if (raw.trim() === "") return null;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_DAYS_PER_WEEK || days > MAX_DAYS_PER_WEEK) {
    return null;
  }
  return days;
}

/**
 * U14 (CODEBASE_ANALYSIS_2026-10-03): the field used to commit every keystroke,
 * so clearing it snapped back to 5 and typing next to the digit ("53") clamped
 * to 7, resetting the rest days each time. The text is now a local draft and
 * only a whole number in range is committed; anything else waits, and blur
 * restores the last committed value.
 */
function DaysPerWeekField({
  value,
  onChange,
}: Readonly<{ value: number; onChange: (value: number) => void }>) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  const draftInvalid = draft.trim() !== "" && parseDaysPerWeek(draft) === null;

  return (
    <div className="space-y-2">
      <Label htmlFor="days">Days/Week</Label>
      <Input
        id="days"
        type="number"
        inputMode="numeric"
        min={MIN_DAYS_PER_WEEK}
        max={MAX_DAYS_PER_WEEK}
        value={draft}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const days = parseDaysPerWeek(raw);
          if (days !== null && days !== value) onChange(days);
        }}
        onBlur={() => {
          setDraft(String(value));
        }}
        errorMessage={
          draftInvalid
            ? `Enter a whole number from ${String(MIN_DAYS_PER_WEEK)} to ${String(MAX_DAYS_PER_WEEK)}.`
            : undefined
        }
      />
    </div>
  );
}
