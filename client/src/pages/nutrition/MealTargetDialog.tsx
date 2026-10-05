import { type MealFuelValues, mergeMealOverride } from "@shared/mealFuelling";
import type { MealFuelTarget, MealType } from "@shared/schema";
import { Loader2, RotateCcw } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClearMealTargetOverride, useSetMealTargetOverride } from "@/hooks/useNutrition";

import { MacroTargetInputs, targetInputValues, useMacroTargetForm } from "./macroTargetForm";
import { MEAL_LABELS, type TargetLike } from "./utils";

export interface MealTargetDialogState {
  readonly mealType: MealType;
  /** The currently shown target for the meal (computed, or an existing override). */
  readonly target: MealFuelTarget;
  /** Whether this meal already carries a user override (enables Reset). */
  readonly isOverridden: boolean;
}

const CALORIES_FIELD = ["calories"] as const;

/**
 * The pins a meal's editor starts from: its stored override, less a calorie
 * figure the pinned macros overrule (rule 1 of mergeMealOverride). Rows the old
 * editor saved hold such an echo beside every macro edit; seeding it would
 * bring it back as a live pin the moment a macro is cleared.
 * C21 (CODEBASE_ANALYSIS_2026-10-03)
 */
function pinsInEffect(target: MealFuelTarget, split: MealFuelValues): TargetLike | null {
  const pins = target.override;
  if (!pins) return null;
  return mergeMealOverride(split, pins).caloriesFromMacros ? { ...pins, calories: null } : pins;
}

function MealTargetForm({
  state,
  onClose,
}: {
  readonly state: MealTargetDialogState;
  readonly onClose: () => void;
}) {
  const setOverride = useSetMealTargetOverride();
  const clearOverride = useClearMealTargetOverride();
  // What a blank field falls back to: the split the override replaced, or the
  // shown target when nothing is pinned yet.
  const split = state.target.suggested ?? state.target;
  // Seeded from what is pinned, not from the shown target: every shown value
  // went back as a pin, so a calorie edit on a calorie-only day carried 0 g
  // macros that counted as macro overrides, and the calories were rebuilt from
  // them. Clearing a pinned field unpins it. C21 (CODEBASE_ANALYSIS_2026-10-03)
  const { values, setField, parsed, valid } = useMacroTargetForm(pinsInEffect(state.target, split));
  // What a save makes the meal read, by the merge the server applies. The
  // placeholders show it, and when the pinned macros set the calories the field
  // shows their figure, locked, and a save pins no calories beside them. The
  // field stayed editable and its number was dropped (a legacy row edited to
  // 900 kcal still read 840), and the calorie placeholder showed the split's
  // 720 where a 50 g protein pin reads 770. C21 (CODEBASE_ANALYSIS_2026-10-03)
  const preview = mergeMealOverride(split, parsed);
  const previewValues = targetInputValues(preview);
  const caloriesLocked = preview.caloriesFromMacros;
  // The note saying why the calories are locked describes the locked field, so
  // a screen reader announces it there. C21 (CODEBASE_ANALYSIS_2026-10-03)
  const caloriesNoteId = useId();
  const pending = setOverride.isPending || clearOverride.isPending;

  const submit = () => {
    if (!valid) return;
    const calories = caloriesLocked ? null : parsed.calories;
    setOverride.mutate({ mealType: state.mealType, ...parsed, calories }, { onSuccess: onClose });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adjust {MEAL_LABELS[state.mealType] ?? "meal"} target</DialogTitle>
        <DialogDescription className="sr-only">
          Override macro targets for this meal
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Pin this meal&apos;s goals. A blank field follows the figure shown in it; changes apply from
        today.
      </p>

      <MacroTargetInputs
        values={caloriesLocked ? { ...values, calories: previewValues.calories } : values}
        onChange={setField}
        idPrefix="meal-target"
        placeholders={previewValues}
        lockedKeys={caloriesLocked ? CALORIES_FIELD : undefined}
        lockedNoteId={caloriesNoteId}
      />
      {caloriesLocked && (
        <p
          id={caloriesNoteId}
          className="text-xs text-muted-foreground"
          data-testid="text-meal-target-calories-from-macros"
        >
          Calories follow the three macros you pinned. Clear a macro to set calories yourself.
        </p>
      )}
      {/* The field locks as the third macro is typed, away from it: say so as
          it happens, not only on focusing the field. C21 (CODEBASE_ANALYSIS_2026-10-03) */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="status-meal-target-calories"
      >
        {caloriesLocked ? "Calories now follow the three macros you pinned." : ""}
      </span>

      <DialogFooter className="gap-2 sm:justify-between">
        {state.isOverridden ? (
          <Button
            variant="ghost"
            onClick={() => clearOverride.mutate(state.mealType, { onSuccess: onClose })}
            disabled={pending}
            data-testid="button-reset-meal-target"
          >
            {clearOverride.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
            )}
            {clearOverride.isPending ? "Resetting…" : "Reset to suggested"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || pending}
            data-testid="button-save-meal-target"
          >
            {setOverride.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
            )}
            {setOverride.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** Per-meal target override editor — mirrors TargetsDialog for a single meal. */
export function MealTargetDialog({
  state,
  onClose,
}: {
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
        {state && <MealTargetForm key={state.mealType} state={state} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
