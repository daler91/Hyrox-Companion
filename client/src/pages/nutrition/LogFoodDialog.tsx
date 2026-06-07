import {
  type Food,
  type FoodLogEntryWithNutrition,
  MEAL_TYPES,
  type MealType,
  type NutritionMacroTotals,
} from "@shared/schema";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogFood, useUpdateLog } from "@/hooks/useNutrition";

import { loggedAtForDate, MEAL_LABELS, previewNutrition } from "./utils";

/** Either creating a log from a searched/quick-add food, or editing an entry. */
export type LogDialogState =
  | { mode: "create"; food: Food }
  | { mode: "edit"; entry: FoodLogEntryWithNutrition };

const PREVIEW_FIELDS: ReadonlyArray<{ key: keyof NutritionMacroTotals; label: string }> = [
  { key: "calories", label: "kcal" },
  { key: "protein", label: "P" },
  { key: "carb", label: "C" },
  { key: "fat", label: "F" },
  { key: "fiber", label: "Fib" },
];

function defaultMealForNow(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

/** Scale an existing entry's nutrition proportionally for the edit preview. */
function scaleEntryPreview(
  entry: FoodLogEntryWithNutrition,
  quantityG: number,
): NutritionMacroTotals {
  const factor = entry.quantityG > 0 ? quantityG / entry.quantityG : 0;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    calories: Math.round(entry.nutrition.calories * factor),
    protein: r1(entry.nutrition.protein * factor),
    carb: r1(entry.nutrition.carb * factor),
    fat: r1(entry.nutrition.fat * factor),
    fiber: r1(entry.nutrition.fiber * factor),
  };
}

/**
 * Inner form, mounted with a `key` per food/entry so opening a different item
 * remounts it and re-seeds the `useState` initializers — no reset effect needed.
 */
function LogFoodForm({
  state,
  date,
  onClose,
}: {
  readonly state: LogDialogState;
  readonly date: string;
  readonly onClose: () => void;
}) {
  const logFood = useLogFood(date);
  const updateLog = useUpdateLog(date);
  const isCreate = state.mode === "create";

  const [quantityG, setQuantityG] = useState(() =>
    isCreate ? Math.round(state.food.servingSizeG ?? 100) : Math.round(state.entry.quantityG),
  );
  const [mealType, setMealType] = useState<MealType>(() =>
    isCreate ? defaultMealForNow() : state.entry.mealType,
  );

  const name = isCreate ? state.food.name : state.entry.name;
  const brand = isCreate ? state.food.brand : state.entry.brand;
  const servingSizeG = isCreate ? state.food.servingSizeG : null;
  const preview = isCreate
    ? previewNutrition(state.food, quantityG)
    : scaleEntryPreview(state.entry, quantityG);
  const isPending = logFood.isPending || updateLog.isPending;
  const validQuantity = Number.isFinite(quantityG) && quantityG > 0;

  const handleSubmit = () => {
    if (!validQuantity) return;
    if (state.mode === "create") {
      logFood.mutate(
        { foodId: state.food.id, quantityG, mealType, loggedAt: loggedAtForDate(date) },
        { onSuccess: onClose },
      );
    } else {
      updateLog.mutate({ id: state.entry.id, data: { quantityG, mealType } }, { onSuccess: onClose });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isCreate ? "Log food" : "Edit entry"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {brand && <p className="truncate text-sm text-muted-foreground">{brand}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="log-quantity">Quantity (grams)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="log-quantity"
              type="number"
              min={1}
              inputMode="numeric"
              value={Number.isFinite(quantityG) ? quantityG : ""}
              onChange={(e) => setQuantityG(Number(e.target.value))}
              data-testid="input-quantity"
            />
            {servingSizeG ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setQuantityG(Math.round(servingSizeG))}
                data-testid="button-one-serving"
              >
                1 serving ({Math.round(servingSizeG)} g)
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="log-meal">Meal</Label>
          <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
            <SelectTrigger id="log-meal" data-testid="select-meal-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEAL_TYPES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MEAL_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-5 gap-2 rounded-md bg-muted/40 p-3 text-center">
          {PREVIEW_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="text-sm font-semibold tabular-nums" data-testid={`preview-${f.key}`}>
                {preview[f.key]}
              </div>
              <div className="text-[10px] uppercase text-muted-foreground">{f.label}</div>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!validQuantity || isPending}
          data-testid="button-submit-log"
        >
          {isCreate ? "Log it" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function LogFoodDialog({
  state,
  date,
  onClose,
}: {
  readonly state: LogDialogState | null;
  readonly date: string;
  readonly onClose: () => void;
}) {
  const formKey = state
    ? state.mode === "create"
      ? `create:${state.food.id}`
      : `edit:${state.entry.id}`
    : "closed";

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="dialog-log-food">
        {state && <LogFoodForm key={formKey} state={state} date={date} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
