import type { MealFuelTarget, MealType } from "@shared/schema";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClearMealTargetOverride, useSetMealTargetOverride } from "@/hooks/useNutrition";

import { MacroTargetInputs, useMacroTargetForm } from "./macroTargetForm";
import { MEAL_LABELS } from "./utils";

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
  const { values, setField, parsed, valid } = useMacroTargetForm(state.target);
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

      <MacroTargetInputs values={values} onChange={setField} idPrefix="meal-target" />

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
