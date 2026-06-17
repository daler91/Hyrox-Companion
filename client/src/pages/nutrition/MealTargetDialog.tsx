import type { MealFuelTarget, MealType } from "@shared/schema";
import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClearMealTargetOverride, useSetMealTargetOverride } from "@/hooks/useNutrition";

import { MEAL_LABELS } from "./utils";

const FIELDS = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "proteinG", label: "Protein (g)" },
  { key: "carbG", label: "Carbs (g)" },
  { key: "fatG", label: "Fat (g)" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

export interface MealTargetDialogState {
  readonly mealType: MealType;
  /** The currently shown target for the meal (computed, or an existing override). */
  readonly target: MealFuelTarget;
  /** Whether this meal already carries a user override (enables Reset). */
  readonly isOverridden: boolean;
}

function MealTargetForm({
  date,
  state,
  onClose,
}: {
  readonly date: string;
  readonly state: MealTargetDialogState;
  readonly onClose: () => void;
}) {
  const setOverride = useSetMealTargetOverride(date);
  const clearOverride = useClearMealTargetOverride(date);
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    calories: numToStr(state.target.calories),
    proteinG: numToStr(state.target.proteinG),
    carbG: numToStr(state.target.carbG),
    fatG: numToStr(state.target.fatG),
  }));

  const parsed = {
    calories: parseNum(values.calories),
    proteinG: parseNum(values.proteinG),
    carbG: parseNum(values.carbG),
    fatG: parseNum(values.fatG),
  };
  const valid = Object.values(parsed).some((v) => v != null);
  const pending = setOverride.isPending || clearOverride.isPending;

  const submit = () => {
    if (!valid) return;
    setOverride.mutate({ mealType: state.mealType, ...parsed }, { onSuccess: onClose });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adjust {MEAL_LABELS[state.mealType] ?? "meal"} target</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Pin this meal's goals. Leave a field blank to keep the suggested value; changes apply from
        today.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`meal-target-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`meal-target-${f.key}`}
              type="number"
              min={0}
              inputMode="decimal"
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              data-testid={`input-meal-target-${f.key}`}
            />
          </div>
        ))}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {state.isOverridden ? (
          <Button
            variant="ghost"
            onClick={() => clearOverride.mutate(state.mealType, { onSuccess: onClose })}
            disabled={pending}
            data-testid="button-reset-meal-target"
          >
            <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
            Reset to suggested
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || pending} data-testid="button-save-meal-target">
            Save
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** Per-meal target override editor — mirrors TargetsDialog for a single meal. */
export function MealTargetDialog({
  date,
  state,
  onClose,
}: {
  readonly date: string;
  readonly state: MealTargetDialogState | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent data-testid="dialog-meal-target">
        {state && <MealTargetForm key={state.mealType} date={date} state={state} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
