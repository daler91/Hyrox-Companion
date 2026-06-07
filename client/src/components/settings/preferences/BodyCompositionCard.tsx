import { cmToFtIn, ftInToCm, kgToUserWeight, standardizeWeightUnit, userWeightToKg } from "@shared/unitConversion";
import { useEffect, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { PreferenceSelectRow } from "./PreferenceRows";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Controlled numeric input that edits a CANONICAL value (kg/cm) through a
 * display conversion, holding a string buffer so a value being typed never
 * round-trips through the converter (which would drift, e.g. 154 lb → 69.85 kg →
 * 153.99 lb). Re-seeds the buffer from the prop only on EXTERNAL changes (initial
 * load, Undo) or when `seedKey` (the unit) changes — never from its own push,
 * which the `pushed` ref distinguishes.
 */
function useCanonicalInput(
  canonical: number | null,
  toDisplay: (c: number) => number,
  fromDisplay: (d: number) => number,
  seedKey: string,
  onChange: (c: number | null) => void,
): readonly [string, (next: string) => void] {
  const fmt = (c: number | null) => (c == null ? "" : String(round1(toDisplay(c))));
  const [text, setText] = useState<string>(() => fmt(canonical));
  const pushed = useRef(canonical);
  const seed = useRef(seedKey);

  useEffect(() => {
    if (canonical !== pushed.current || seedKey !== seed.current) {
      pushed.current = canonical;
      seed.current = seedKey;
      setText(fmt(canonical));
    }
    // fmt/toDisplay are recreated each render but the guard above keeps this a
    // no-op unless the canonical value or unit actually changed externally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical, seedKey]);

  const onText = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      pushed.current = null;
      onChange(null);
      return;
    }
    const display = Number(trimmed);
    if (!Number.isFinite(display) || display <= 0) return; // keep the text, ignore the value
    const c = fromDisplay(display);
    pushed.current = c;
    onChange(c);
  };

  return [text, onText] as const;
}

const identity = (n: number) => n;

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Sedentary" },
  { value: "light", label: "Light" },
  { value: "moderate", label: "Moderate" },
  { value: "active", label: "Active" },
  { value: "very_active", label: "Very active" },
] as const;

const GOAL_OPTIONS = [
  { value: "lose", label: "Lose" },
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain" },
] as const;

interface BodyCompositionCardProps {
  readonly weightUnit: string;
  readonly bodyweightKg: number | null;
  readonly heightCm: number | null;
  readonly activityLevel: string;
  readonly weightGoalDirection: string;
  readonly weightGoalRateKgPerWeek: number | null;
  readonly onBodyweightKgChange: (value: number | null) => void;
  readonly onHeightCmChange: (value: number | null) => void;
  readonly onActivityLevelChange: (value: string) => void;
  readonly onWeightGoalDirectionChange: (value: string) => void;
  readonly onWeightGoalRateKgPerWeekChange: (value: number | null) => void;
}

export function BodyCompositionCard({
  weightUnit,
  bodyweightKg,
  heightCm,
  activityLevel,
  weightGoalDirection,
  weightGoalRateKgPerWeek,
  onBodyweightKgChange,
  onHeightCmChange,
  onActivityLevelChange,
  onWeightGoalDirectionChange,
  onWeightGoalRateKgPerWeekChange,
}: Readonly<BodyCompositionCardProps>) {
  const unit = standardizeWeightUnit(weightUnit);
  const imperial = unit === "lbs";
  const rateUnit = `${unit}/week`;

  const [bodyweightText, onBodyweightText] = useCanonicalInput(
    bodyweightKg,
    (kg) => kgToUserWeight(kg, unit),
    (display) => userWeightToKg(display, unit),
    unit,
    onBodyweightKgChange,
  );
  const [rateText, onRateText] = useCanonicalInput(
    weightGoalRateKgPerWeek,
    (kg) => kgToUserWeight(kg, unit),
    (display) => userWeightToKg(display, unit),
    unit,
    onWeightGoalRateKgPerWeekChange,
  );
  // Metric height: a single cm field (identity conversion). Imperial height is
  // handled by the dedicated ft/in pair below.
  const [heightCmText, onHeightCmText] = useCanonicalInput(
    heightCm,
    identity,
    identity,
    "cm",
    onHeightCmChange,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Body composition</CardTitle>
        <CardDescription>
          Used to calculate your daily calorie and macro targets. All optional — your numbers stay
          on your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="body-weight">Bodyweight</Label>
            <p className="text-sm text-muted-foreground">Your current weight in {unit}.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="body-weight"
              type="number"
              inputMode="decimal"
              min={0}
              value={bodyweightText}
              onChange={(e) => onBodyweightText(e.target.value)}
              className="w-24"
              data-testid="input-bodyweight"
              aria-label={`Bodyweight in ${unit}`}
            />
            <span className="text-sm text-muted-foreground w-8">{unit}</span>
          </div>
        </div>

        {imperial ? (
          <HeightFtIn heightCm={heightCm} onHeightCmChange={onHeightCmChange} />
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="body-height">Height</Label>
              <p className="text-sm text-muted-foreground">Your height in centimetres.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="body-height"
                type="number"
                inputMode="decimal"
                min={0}
                value={heightCmText}
                onChange={(e) => onHeightCmText(e.target.value)}
                className="w-24"
                data-testid="input-height-cm"
                aria-label="Height in centimetres"
              />
              <span className="text-sm text-muted-foreground w-8">cm</span>
            </div>
          </div>
        )}

        <PreferenceSelectRow
          label="Activity level"
          description="Day-to-day activity outside training; sets your baseline calorie burn."
          value={activityLevel || ""}
          onValueChange={onActivityLevelChange}
          options={ACTIVITY_OPTIONS}
          testId="select-activity-level"
          ariaLabel="Select activity level"
          triggerClassName="w-36"
        />

        <PreferenceSelectRow
          label="Weight goal"
          description="Whether your calorie target aims to lose, maintain, or gain weight."
          value={weightGoalDirection || ""}
          onValueChange={onWeightGoalDirectionChange}
          options={GOAL_OPTIONS}
          testId="select-weight-goal"
          ariaLabel="Select weight goal"
          triggerClassName="w-32"
        />

        {weightGoalDirection === "lose" || weightGoalDirection === "gain" ? (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="body-rate">Weekly rate</Label>
              <p className="text-sm text-muted-foreground">
                Target weight change per week ({rateUnit}).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="body-rate"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                value={rateText}
                onChange={(e) => onRateText(e.target.value)}
                className="w-24"
                data-testid="input-weight-rate"
                aria-label={`Weekly weight-change rate in ${rateUnit}`}
              />
              <span className="text-sm text-muted-foreground w-14">{rateUnit}</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Imperial height as feet + inches, combined into canonical centimetres. */
function HeightFtIn({
  heightCm,
  onHeightCmChange,
}: {
  readonly heightCm: number | null;
  readonly onHeightCmChange: (value: number | null) => void;
}) {
  const derived = heightCm == null ? null : cmToFtIn(heightCm);
  const [feet, setFeet] = useState<string>(() => (derived ? String(derived.feet) : ""));
  const [inches, setInches] = useState<string>(() => (derived ? String(derived.inches) : ""));
  const pushed = useRef(heightCm);

  // Re-seed both fields from the canonical prop on external changes (load/undo).
  useEffect(() => {
    if (heightCm !== pushed.current) {
      pushed.current = heightCm;
      const next = heightCm == null ? null : cmToFtIn(heightCm);
      setFeet(next ? String(next.feet) : "");
      setInches(next ? String(next.inches) : "");
    }
  }, [heightCm]);

  const push = (ftStr: string, inStr: string) => {
    const ft = ftStr.trim() === "" ? 0 : Number(ftStr);
    const inch = inStr.trim() === "" ? 0 : Number(inStr);
    if (ftStr.trim() === "" && inStr.trim() === "") {
      pushed.current = null;
      onHeightCmChange(null);
      return;
    }
    if (!Number.isFinite(ft) || !Number.isFinite(inch) || ft < 0 || inch < 0) return;
    const cm = ftInToCm(ft, inch);
    pushed.current = cm;
    onHeightCmChange(cm);
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="body-height-ft">Height</Label>
        <p className="text-sm text-muted-foreground">Your height in feet and inches.</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="body-height-ft"
          type="number"
          inputMode="numeric"
          min={0}
          value={feet}
          onChange={(e) => {
            setFeet(e.target.value);
            push(e.target.value, inches);
          }}
          className="w-16"
          data-testid="input-height-ft"
          aria-label="Height feet"
        />
        <span className="text-sm text-muted-foreground">ft</span>
        <Input
          id="body-height-in"
          type="number"
          inputMode="numeric"
          min={0}
          max={11}
          value={inches}
          onChange={(e) => {
            setInches(e.target.value);
            push(feet, e.target.value);
          }}
          className="w-16"
          data-testid="input-height-in"
          aria-label="Height inches"
        />
        <span className="text-sm text-muted-foreground">in</span>
      </div>
    </div>
  );
}
