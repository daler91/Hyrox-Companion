import {
  type BmrSex,
  calculateNutritionTarget,
  defaultPeriodizationConfig,
} from "@shared/nutritionTargets";
import type { NutritionTarget } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSetTarget } from "@/hooks/useNutrition";
import { QUERY_KEYS, type UserPreferences } from "@/lib/api";

import { MacroTargetInputs, useMacroTargetForm } from "./macroTargetForm";

/** Profile fields required before a target can be auto-calculated. */
function canCalculateFromProfile(p: UserPreferences | undefined): p is UserPreferences {
  return (
    p?.bodyweightKg != null &&
    p?.heightCm != null &&
    p?.age != null &&
    p?.activityLevel != null &&
    p?.weightGoalDirection != null
  );
}

function TargetsForm({
  current,
  onClose,
}: {
  readonly current: NutritionTarget | null;
  readonly onClose: () => void;
}) {
  const setTarget = useSetTarget();
  const { data: profile } = useQuery<UserPreferences>({ queryKey: QUERY_KEYS.preferences });
  const { values, setValues, setField, parsed, valid } = useMacroTargetForm(current);
  const [periodize, setPeriodize] = useState<boolean>(current?.periodizationEnabled ?? false);
  const [calcNote, setCalcNote] = useState<string | null>(null);

  const canCalculate = canCalculateFromProfile(profile);

  const calculate = () => {
    if (!canCalculate) return;
    let sex: BmrSex = null;
    if (profile.gender === "male") sex = "male";
    else if (profile.gender === "female") sex = "female";
    const result = calculateNutritionTarget({
      bodyweightKg: profile.bodyweightKg!,
      heightCm: profile.heightCm!,
      ageYears: profile.age!,
      sex,
      activityLevel: profile.activityLevel!,
      goalDirection: profile.weightGoalDirection!,
      goalRateKgPerWeek: profile.weightGoalRateKgPerWeek ?? 0,
    });
    setValues({
      calories: String(result.calories),
      proteinG: String(result.proteinG),
      carbG: String(result.carbG),
      fatG: String(result.fatG),
    });
    setCalcNote(result.warning ?? result.explanation);
  };

  const submit = () => {
    if (!valid) return;
    // Periodisation only makes sense with a carb baseline to scale.
    const scaling = periodize && parsed.carbG != null;
    let config: { referenceUtss: number; carbGramsPerUtss: number } | null = null;
    if (scaling) {
      config =
        current?.periodizationEnabled &&
        current.referenceUtss != null &&
        current.carbGramsPerUtss != null
          ? { referenceUtss: current.referenceUtss, carbGramsPerUtss: current.carbGramsPerUtss }
          : defaultPeriodizationConfig(parsed.carbG!, 0);
    }
    setTarget.mutate(
      {
        ...parsed,
        periodizationEnabled: scaling,
        referenceUtss: scaling ? config!.referenceUtss : null,
        carbGramsPerUtss: scaling ? config!.carbGramsPerUtss : null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set nutrition targets</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Your daily goals. Leave a field blank to skip that goal; changes apply from today.
      </p>

      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={calculate}
          disabled={!canCalculate}
          data-testid="button-calculate-targets"
        >
          <Calculator className="h-4 w-4 mr-2" aria-hidden="true" />
          Calculate from profile
        </Button>
        {canCalculate && calcNote ? (
          <p className="text-xs text-muted-foreground" data-testid="text-calc-note">
            {calcNote}
          </p>
        ) : null}
        {!canCalculate && (
          <p className="text-xs text-muted-foreground">
            Add your bodyweight, height, age, activity level and weight goal in Settings to
            auto-calculate.
          </p>
        )}
      </div>

      <MacroTargetInputs values={values} onChange={setField} idPrefix="target" />

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="target-periodize" className="text-sm cursor-pointer">
            Scale carbs by training load
          </Label>
          <p className="text-xs text-muted-foreground">
            Raise your carb target on hard days and lower it on rest days, based on each day's
            training. Protein and fat stay fixed.
          </p>
        </div>
        <Switch
          id="target-periodize"
          checked={periodize}
          onCheckedChange={setPeriodize}
          disabled={parsed.carbG == null}
          data-testid="switch-periodize"
          aria-label="Scale carbs by training load"
        />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={setTarget.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid || setTarget.isPending} data-testid="button-save-targets">
          Save targets
        </Button>
      </DialogFooter>
    </>
  );
}

/** Editor for the user's macro/calorie targets (FR-5.2). */
export function TargetsDialog({
  open,
  current,
  onClose,
}: {
  readonly open: boolean;
  readonly current: NutritionTarget | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="dialog-targets">
        {open && <TargetsForm key={current?.id ?? "new"} current={current} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
