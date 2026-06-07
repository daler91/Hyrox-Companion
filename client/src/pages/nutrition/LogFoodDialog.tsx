import {
  type Food,
  type FoodLogEntryWithNutrition,
  MEAL_TYPES,
  type MealType,
  type NutritionMacroTotals,
} from "@shared/schema";
import { useMemo, useState } from "react";

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
import { useFoodWithServings, useLogFood, useUpdateLog } from "@/hooks/useNutrition";

import { loggedAtForDate, MEAL_LABELS, previewNutrition } from "./utils";

/** Either creating a log from a searched/quick-add/barcode food, or editing an entry. */
export type LogDialogState =
  | { mode: "create"; food: Food; entryMethod?: "manual" | "barcode" }
  | { mode: "edit"; entry: FoodLogEntryWithNutrition };

interface UnitOption {
  value: string;
  label: string;
  grams: number;
}

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
function scaleEntryPreview(entry: FoodLogEntryWithNutrition, quantityG: number): NutritionMacroTotals {
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

  // Named servings for the unit selector (create mode) — also enriches USDA portions.
  const servingsQuery = useFoodWithServings(state.mode === "create" ? state.food.id : null);

  // create mode: a count + a unit (grams / named serving). edit mode: grams.
  const [count, setCount] = useState(() =>
    state.mode === "create" ? Math.round(state.food.servingSizeG ?? 100) : 0,
  );
  const [unitValue, setUnitValue] = useState("g");
  const [editQuantityG, setEditQuantityG] = useState(() =>
    state.mode === "edit" ? Math.round(state.entry.quantityG) : 0,
  );
  const [mealType, setMealType] = useState<MealType>(() =>
    state.mode === "create" ? defaultMealForNow() : state.entry.mealType,
  );

  const unitOptions = useMemo<UnitOption[]>(() => {
    const opts: UnitOption[] = [{ value: "g", label: "grams", grams: 1 }];
    if (state.mode !== "create") return opts;
    const fetchedServings = servingsQuery.data?.servings ?? [];
    for (const s of fetchedServings) opts.push({ value: s.id, label: s.label, grams: s.grams });
    const ssg = state.food.servingSizeG;
    if (ssg && ssg > 0 && !fetchedServings.some((s) => Math.abs(s.grams - ssg) < 0.5)) {
      opts.push({ value: "__serving", label: `1 serving (${Math.round(ssg)} g)`, grams: ssg });
    }
    return opts;
  }, [state, servingsQuery.data]);

  const selectedUnit = unitOptions.find((o) => o.value === unitValue) ?? unitOptions[0];
  const quantityG = isCreate ? count * (selectedUnit?.grams ?? 1) : editQuantityG;

  const name = state.mode === "create" ? state.food.name : state.entry.name;
  const brand = state.mode === "create" ? state.food.brand : state.entry.brand;
  const preview =
    state.mode === "create"
      ? previewNutrition(state.food, quantityG)
      : scaleEntryPreview(state.entry, quantityG);
  const isPending = logFood.isPending || updateLog.isPending;
  const validQuantity = Number.isFinite(quantityG) && quantityG > 0;

  const handleSubmit = () => {
    if (!validQuantity) return;
    if (state.mode === "create") {
      logFood.mutate(
        {
          foodId: state.food.id,
          quantityG,
          mealType,
          loggedAt: loggedAtForDate(date),
          entryMethod: state.entryMethod,
        },
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

        {isCreate ? (
          <div className="space-y-1.5">
            <Label htmlFor="log-quantity">Amount</Label>
            <div className="flex items-center gap-2">
              <Input
                id="log-quantity"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className="w-24"
                value={Number.isFinite(count) ? count : ""}
                onChange={(e) => setCount(Number(e.target.value))}
                data-testid="input-quantity"
              />
              <Select value={unitValue} onValueChange={setUnitValue}>
                <SelectTrigger className="flex-1" data-testid="select-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedUnit && selectedUnit.value !== "g" && (
              <p className="text-xs text-muted-foreground">= {Math.round(quantityG)} g</p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="log-quantity">Quantity (grams)</Label>
            <Input
              id="log-quantity"
              type="number"
              min={1}
              inputMode="numeric"
              value={Number.isFinite(editQuantityG) ? editQuantityG : ""}
              onChange={(e) => setEditQuantityG(Number(e.target.value))}
              data-testid="input-quantity"
            />
          </div>
        )}

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

function getFormKey(state: LogDialogState | null): string {
  if (!state) return "closed";
  return state.mode === "create" ? `create:${state.food.id}` : `edit:${state.entry.id}`;
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
  const formKey = getFormKey(state);

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
