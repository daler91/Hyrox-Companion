import { isIsoCalendarDate } from "@shared/dateUtils";
import {
  Activity,
  Check,
  Dumbbell,
  type LucideIcon,
  Target,
  TrendingDown,
  Zap,
} from "lucide-react";
import type { Ref } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getTodayString } from "@/lib/dateUtils";

import { ONBOARDING_GOALS, type OnboardingGoalId } from "./onboardingGoals";

const goalIcons: Record<OnboardingGoalId, LucideIcon> = {
  strength: Dumbbell,
  endurance: Activity,
  functional: Zap,
  weight_loss: TrendingDown,
  fitness: Target,
};

interface GoalStepProps {
  readonly selectedGoal: string;
  readonly onGoalChange: (goal: string) => void;
  readonly trainingStyleId: string;
  readonly onTrainingStyleChange: (style: string) => void;
  readonly mafAge: string;
  readonly onMafAgeChange: (age: string) => void;
  readonly mafCategory: string;
  readonly onMafCategoryChange: (value: string) => void;
  readonly mafHrDataAvailable: boolean;
  readonly onMafHrDataAvailableChange: (value: boolean) => void;
  /** As typed: "YYYY-MM-DD", or "" when the athlete has no race booked. */
  readonly raceDate?: string;
  /** What was typed; whether it can be used is raceDateError's call (CL9). */
  readonly onRaceDateChange?: (value: string) => void;
  /** Earliest race date offered (today). */
  readonly minRaceDate?: string;
  /** The race-date input, so the wizard can focus it when it holds the step. */
  readonly raceDateInputRef?: Ref<HTMLInputElement>;
  /** Why the MAF answers can't be saved yet, shown under each field. */
  readonly mafErrors?: { readonly age?: string; readonly category?: string };
}

const NOT_A_REAL_DATE = "That isn't a real date. Check the year, or leave it blank.";
const DATE_HAS_PASSED = "That date has passed. Pick today or later, or leave it blank.";

interface RaceDateFieldProps {
  readonly raceDate: string;
  readonly onRaceDateChange: (value: string) => void;
  readonly minRaceDate: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * Why a typed race date ("YYYY-MM-DD", "" for none) can't be used, or null
 * when it can: it is blank, or a real day no earlier than `today`. The native
 * `min` only limits the picker: a typed date before it still arrives, and a
 * past race (a mistyped year) made every day of a template plan post-race
 * recovery. A browser date field also takes a five-digit year ("20266-11-15"),
 * which sorts after any four-digit today; the server's format check then
 * refused it at Start Training with a generic toast. The step shows this and
 * the wizard checks it again on Continue, so both apply the same rule.
 * CL9 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function raceDateError(raceDate: string, today: string): string | null {
  if (raceDate === "") return null;
  if (!isIsoCalendarDate(raceDate)) return NOT_A_REAL_DATE;
  return raceDate < today ? DATE_HAS_PASSED : null;
}

/**
 * The optional race date, as typed. One that can't be used is named here, and
 * the wizard holds the Goal step until it is corrected or cleared.
 * CL9 (CODEBASE_ANALYSIS_2026-10-03)
 */
function RaceDateField({ raceDate, onRaceDateChange, minRaceDate, inputRef }: RaceDateFieldProps) {
  const error = raceDateError(raceDate, minRaceDate);
  return (
    <div className="space-y-2">
      <Label htmlFor="onboarding-race-date">
        Race date <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <p id="onboarding-race-date-hint" className="text-xs text-muted-foreground">
        Booked a HYROX race? Your plan and coach will build toward it.
      </p>
      <Input
        ref={inputRef}
        id="onboarding-race-date"
        type="date"
        min={minRaceDate}
        className="w-auto"
        value={raceDate}
        onChange={(e) => {
          onRaceDateChange(e.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error
            ? "onboarding-race-date-hint onboarding-race-date-error"
            : "onboarding-race-date-hint"
        }
        data-testid="input-onboarding-race-date"
      />
      {error && (
        <p id="onboarding-race-date-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function GoalStep(props: Readonly<GoalStepProps>) {
  const { selectedGoal, onGoalChange, trainingStyleId, mafErrors } = props;
  return (
    <div className="space-y-4">
      <RadioGroup
        value={selectedGoal}
        onValueChange={onGoalChange}
        className="space-y-3"
        aria-label="Goal"
      >
        {ONBOARDING_GOALS.map((goal) => {
          const Icon = goalIcons[goal.id];
          return (
            // A <label> wrapping the radio replaces the previous
            // <button><RadioGroupItem/></button> (a <button> nested inside the
            // Radix radio's own <button>), which was invalid HTML and gave
            // undefined keyboard/AT behavior. Selection now flows through the
            // RadioGroup (onValueChange), and focus-within rings the card while
            // the inner radio is focused. (WCAG 4.1.2 / 1.3.1)
            <label
              key={goal.id}
              htmlFor={goal.id}
              className={`w-full text-left flex items-center space-x-3 p-3 rounded-md border cursor-pointer transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring ${
                selectedGoal === goal.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <RadioGroupItem value={goal.id} id={goal.id} />
              <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <div className="flex-1">
                <span className="font-medium">{goal.label}</span>
                <p className="text-xs text-muted-foreground">{goal.description}</p>
              </div>
              {selectedGoal === goal.id && (
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              )}
            </label>
          );
        })}
      </RadioGroup>
      <div className="space-y-2">
        <Label htmlFor="onboarding-training-style">Training style</Label>
        <Select value={trainingStyleId} onValueChange={props.onTrainingStyleChange}>
          <SelectTrigger id="onboarding-training-style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="balanced_default">Balanced</SelectItem>
            <SelectItem value="maf_method">MAF Method</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {/* HYROX athletes train toward a race, so ask for it here; it anchors an
          AI plan's length and is kept on a template plan (onboarding audit M3). */}
      {props.onRaceDateChange && (
        <RaceDateField
          raceDate={props.raceDate ?? ""}
          onRaceDateChange={props.onRaceDateChange}
          minRaceDate={props.minRaceDate ?? getTodayString()}
          inputRef={props.raceDateInputRef}
        />
      )}
      {trainingStyleId === "maf_method" && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">MAF onboarding</p>
          {/* A visible label, and the limits validation actually applies: the
              field was labelled only by its placeholder and allowed 1-120
              while 16-99 was required (onboarding audit M4). */}
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-maf-age">Age</Label>
            <Input
              id="onboarding-maf-age"
              type="number"
              inputMode="numeric"
              min={16}
              max={99}
              className="w-24"
              value={props.mafAge}
              onChange={(e) => props.onMafAgeChange(e.target.value)}
              aria-invalid={mafErrors?.age ? true : undefined}
              aria-describedby={mafErrors?.age ? "onboarding-maf-age-error" : undefined}
            />
            {mafErrors?.age && (
              <p id="onboarding-maf-age-error" className="text-sm text-destructive">
                {mafErrors.age}
              </p>
            )}
          </div>
          {/* Maffetone's own category question, asked as he states it (audit
              M6). The previous boolean + consistency/trend selects collapsed
              his -10 and -5 categories — allergies cost the same 10 bpm as
              post-surgery recovery — and granted +5 with no training-duration
              question at all. */}
          <Select value={props.mafCategory} onValueChange={props.onMafCategoryChange}>
            <SelectTrigger
              aria-label="Maffetone health and training category"
              aria-invalid={mafErrors?.category ? true : undefined}
              aria-describedby={mafErrors?.category ? "onboarding-maf-category-error" : undefined}
            >
              <SelectValue placeholder="Which best describes you?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recovering_or_medicated">
                Recovering from major illness or surgery, or on regular medication
              </SelectItem>
              <SelectItem value="training_interrupted">
                Injured, regressing, frequent colds, allergies/asthma, or new/inconsistent training
              </SelectItem>
              <SelectItem value="consistent_up_to_2y">
                Training consistently (up to 2 years) without those problems
              </SelectItem>
              <SelectItem value="consistent_2y_plus_improving">
                Training 2+ years without those problems, and improving
              </SelectItem>
            </SelectContent>
          </Select>
          {mafErrors?.category && (
            <p id="onboarding-maf-category-error" className="text-sm text-destructive">
              {mafErrors.category}
            </p>
          )}
          <div className="flex items-center justify-between">
            <Label htmlFor="onboarding-maf-hr">HR data available?</Label>
            <Switch
              id="onboarding-maf-hr"
              checked={props.mafHrDataAvailable}
              onCheckedChange={props.onMafHrDataAvailableChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
