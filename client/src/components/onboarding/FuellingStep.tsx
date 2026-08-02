import {
  type ActivityLevel,
  type BmrSex,
  calculateNutritionTarget,
  type NutritionTargetInput,
  type WeightGoalDirection,
} from "@shared/nutritionTargets";
import { convertWeight } from "@shared/unitConversion";

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

/** Modest default rate for a lose/gain goal set during onboarding (kg/week);
 *  refinable later in Settings alongside the rest of the body profile. */
const DEFAULT_GOAL_RATE_KG_PER_WEEK = 0.25;

const ACTIVITY_OPTIONS: ReadonlyArray<{ value: ActivityLevel; label: string }> = [
  { value: "sedentary", label: "Sedentary — desk job, little other exercise" },
  { value: "light", label: "Lightly active — 1–2 sessions a week" },
  { value: "moderate", label: "Moderately active — 3–4 sessions a week" },
  { value: "active", label: "Active — 5–6 sessions a week" },
  { value: "very_active", label: "Very active — daily hard training" },
];

const GOAL_OPTIONS: ReadonlyArray<{ value: WeightGoalDirection; label: string }> = [
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain muscle" },
];

export interface FuellingProfileFields {
  /** Bodyweight as typed, in `weightUnit`. */
  bodyweight: string;
  heightCm: string;
  age: string;
  activityLevel: "" | ActivityLevel;
  weightGoalDirection: WeightGoalDirection;
  weightUnit: "kg" | "lbs";
  gender: "male" | "female" | "prefer_not_to_say";
}

function parsePositive(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The typed fields as a target-calculation input, or null while incomplete or
 * implausible (typo guards keep a mistyped bodyweight from producing an absurd
 * target). Shared by the live preview here and the wizard's save step.
 */
export function parseFuellingProfile(f: FuellingProfileFields): NutritionTargetInput | null {
  const bw = parsePositive(f.bodyweight);
  const height = parsePositive(f.heightCm);
  const age = parsePositive(f.age);
  if (bw == null || height == null || age == null || f.activityLevel === "") return null;

  const bodyweightKg = Math.round(convertWeight(bw, f.weightUnit, "kg") * 10) / 10;
  if (bodyweightKg < 30 || bodyweightKg > 300) return null;
  if (height < 120 || height > 250) return null;
  if (age < 13 || age > 100) return null;

  let sex: BmrSex = null;
  if (f.gender === "male") sex = "male";
  else if (f.gender === "female") sex = "female";

  return {
    bodyweightKg,
    heightCm: height,
    ageYears: age,
    sex,
    activityLevel: f.activityLevel,
    goalDirection: f.weightGoalDirection,
    goalRateKgPerWeek: f.weightGoalDirection === "maintain" ? 0 : DEFAULT_GOAL_RATE_KG_PER_WEEK,
  };
}

/**
 * Optional onboarding step: body profile → suggested daily nutrition targets.
 *
 * The targets engine (shared/nutritionTargets) has always been able to compute
 * a starting target, but the five profile fields it needs previously lived only
 * in a Settings sub-card, so every new user met the nutrition page with blank
 * targets and bare zeros. Collect the fields here, preview the resulting
 * target live, and let the athlete accept it in one tap. Leaving the step
 * blank skips it entirely.
 */
export function FuellingStep({
  fields,
  onBodyweightChange,
  onHeightCmChange,
  onAgeChange,
  onActivityLevelChange,
  onWeightGoalDirectionChange,
  applyTargets,
  onApplyTargetsChange,
}: {
  readonly fields: FuellingProfileFields;
  readonly onBodyweightChange: (v: string) => void;
  readonly onHeightCmChange: (v: string) => void;
  readonly onAgeChange: (v: string) => void;
  readonly onActivityLevelChange: (v: ActivityLevel) => void;
  readonly onWeightGoalDirectionChange: (v: WeightGoalDirection) => void;
  readonly applyTargets: boolean;
  readonly onApplyTargetsChange: (v: boolean) => void;
}) {
  const profile = parseFuellingProfile(fields);
  const suggested = profile ? calculateNutritionTarget(profile) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optional — fill this in and we&apos;ll suggest daily calorie and macro targets to fuel your
        training. Skip it and you can set targets anytime in Nutrition.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fuelling-bodyweight">Weight ({fields.weightUnit})</Label>
          <Input
            id="fuelling-bodyweight"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={fields.bodyweight}
            onChange={(e) => onBodyweightChange(e.target.value)}
            data-testid="input-fuelling-bodyweight"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fuelling-height">Height (cm)</Label>
          <Input
            id="fuelling-height"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={fields.heightCm}
            onChange={(e) => onHeightCmChange(e.target.value)}
            data-testid="input-fuelling-height"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fuelling-age">Age</Label>
          <Input
            id="fuelling-age"
            type="number"
            min={0}
            inputMode="numeric"
            value={fields.age}
            onChange={(e) => onAgeChange(e.target.value)}
            data-testid="input-fuelling-age"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fuelling-activity">Activity level</Label>
        <Select
          value={fields.activityLevel || undefined}
          onValueChange={(v) => onActivityLevelChange(v as ActivityLevel)}
        >
          <SelectTrigger id="fuelling-activity" data-testid="select-fuelling-activity">
            <SelectValue placeholder="Select your training volume" />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fuelling-goal">Weight goal</Label>
        <Select
          value={fields.weightGoalDirection}
          onValueChange={(v) => onWeightGoalDirectionChange(v as WeightGoalDirection)}
        >
          <SelectTrigger id="fuelling-goal" data-testid="select-fuelling-goal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GOAL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {suggested && (
        <div className="space-y-2 rounded-md border p-3" data-testid="fuelling-suggested-targets">
          <p className="text-sm font-medium">
            Suggested daily targets: {suggested.calories} kcal · {suggested.proteinG} g protein ·{" "}
            {suggested.carbG} g carbs · {suggested.fatG} g fat
          </p>
          <p className="text-xs text-muted-foreground">
            {suggested.warning ?? suggested.explanation}
          </p>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="fuelling-apply" className="text-sm cursor-pointer">
              Set these as my daily targets
            </Label>
            <Switch
              id="fuelling-apply"
              checked={applyTargets}
              onCheckedChange={onApplyTargetsChange}
              data-testid="switch-fuelling-apply"
              aria-label="Set these as my daily targets"
            />
          </div>
        </div>
      )}
    </div>
  );
}
