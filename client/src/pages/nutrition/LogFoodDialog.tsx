import {
  type EffectiveTargetSummary,
  type Food,
  type FoodLogEntryWithNutrition,
  type FoodServing,
  MEAL_TYPES,
  type MealType,
  type NutritionMacroTotals,
} from "@shared/schema";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAddServing,
  useFoodWithServings,
  useLogFood,
  useRemoveServing,
  useUpdateLog,
} from "@/hooks/useNutrition";

import { CalorieBreakdownRing } from "./CalorieBreakdownRing";
import { GoalContributionRows } from "./GoalContributionRows";
import { MacroRows } from "./MacroRows";
import { MicronutrientPreviewPanel } from "./MicronutrientPreviewPanel";
import {
  appendUnique,
  buildPreviewMicroRows,
  loggedAtForDate,
  macroEnergyShares,
  MEAL_LABELS,
  previewMicrosScaled,
  previewNutrition,
  projectGoalContribution,
} from "./utils";

/** Either creating a log from a searched/quick-add/barcode food, or editing an entry. */
export type LogDialogState =
  | { mode: "create"; food: Food; entryMethod?: "manual" | "barcode" }
  | { mode: "edit"; entry: FoodLogEntryWithNutrition };

interface UnitOption {
  value: string;
  label: string;
  grams: number;
}

function defaultMealForNow(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

/** Parse the add-portion grams field: a positive finite number, else null. */
function parsePortionGrams(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
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

/** Servings visible to the user (fetched + optimistic), de-duped by id, by grams. */
function computeMergedServings(
  fetched: readonly FoodServing[],
  extra: readonly FoodServing[],
): FoodServing[] {
  const byId = new Map<string, FoodServing>();
  for (const s of fetched) byId.set(s.id, s);
  for (const s of extra) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.grams - b.grams);
}

/** Grams + each named serving as selectable units, plus a synthetic "__serving"
 *  fallback for the food's default serving size when no named portion covers it. */
function computeUnitOptions(
  mergedServings: readonly FoodServing[],
  servingSizeG: number | null,
): UnitOption[] {
  const opts: UnitOption[] = [{ value: "g", label: "grams", grams: 1 }];
  for (const s of mergedServings) opts.push({ value: s.id, label: s.label, grams: s.grams });
  const size = servingSizeG;
  if (size != null && size > 0 && !mergedServings.some((s) => Math.abs(s.grams - size) < 0.5)) {
    opts.push({ value: "__serving", label: `1 serving (${Math.round(size)} g)`, grams: size });
  }
  return opts;
}

/** Resolve the active unit, resilient to a stale selection: exact match, then a
 *  portion matching the serving size, then any portion, then grams. */
function resolveSelectedUnit(
  unitOptions: readonly UnitOption[],
  unitValue: string,
  servingSizeG: number | null,
): UnitOption | undefined {
  const size = servingSizeG;
  return (
    unitOptions.find((o) => o.value === unitValue) ??
    (size != null && size > 0
      ? unitOptions.find((o) => o.value !== "g" && Math.abs(o.grams - size) < 0.5)
      : undefined) ??
    unitOptions.find((o) => o.value !== "g") ??
    unitOptions[0]
  );
}

/** Initial amount: a new food seeds 1 named serving (or 100 g); edit mode starts
 *  at 0 because it drives quantity via grams instead. */
function initialCount(state: LogDialogState, hasServingSize: boolean): number {
  if (state.mode !== "create") return 0;
  return hasServingSize ? 1 : 100;
}

/** Initial unit: the synthetic "__serving" when a new food has a known serving, else grams. */
function initialUnitValue(state: LogDialogState, hasServingSize: boolean): string {
  return state.mode === "create" && hasServingSize ? "__serving" : "g";
}

/** Initial grams for edit mode (rounded); 0 in create mode where count drives it. */
function initialEditGrams(state: LogDialogState): number {
  return state.mode === "edit" ? Math.round(state.entry.quantityG) : 0;
}

/** Initial meal: the time-of-day default for a new log, else the entry's own meal. */
function initialMealType(state: LogDialogState): MealType {
  return state.mode === "create" ? defaultMealForNow() : state.entry.mealType;
}

/** Fields that differ by mode — from the picked Food (create) or the existing
 *  entry (edit) — resolved once so the form body stays mode-agnostic. */
function deriveFoodFields(state: LogDialogState): {
  foodId: string;
  detailFoodId: string;
  servingSizeG: number | null;
  name: string;
  brand: string | null;
} {
  if (state.mode === "create") {
    const { food } = state;
    return {
      foodId: food.id,
      detailFoodId: food.id,
      servingSizeG: food.servingSizeG,
      name: food.name,
      brand: food.brand,
    };
  }
  const { entry } = state;
  return {
    foodId: "",
    detailFoodId: entry.foodId,
    servingSizeG: null,
    name: entry.name,
    brand: entry.brand,
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
  todayTotals,
  effectiveTarget,
}: {
  readonly state: LogDialogState;
  readonly date: string;
  readonly onClose: () => void;
  readonly todayTotals: NutritionMacroTotals | null;
  readonly effectiveTarget: EffectiveTargetSummary | null;
}) {
  const logFood = useLogFood(date);
  const updateLog = useUpdateLog(date);
  const isCreate = state.mode === "create";
  const { foodId, detailFoodId, servingSizeG, name, brand } = deriveFoodFields(state);

  // Food + named servings. Fetched in both modes: create uses the servings for
  // the unit selector; both use the enriched food (USDA micros are filled in on
  // first detail fetch) for the micronutrient preview.
  const servingsQuery = useFoodWithServings(detailFoodId);
  const addServing = useAddServing(foodId);
  const removeServing = useRemoveServing(foodId);

  const hasServingSize = servingSizeG != null && servingSizeG > 0;

  // create mode: a count + a unit (grams / named portion). When the food has a
  // known serving we seed "1 portion" instead of a raw 100 g — the synthetic
  // "__serving" option is derivable from the food up front, so no effect is
  // needed and there's no flash before the named servings load. edit mode: grams.
  const [count, setCount] = useState(() => initialCount(state, hasServingSize));
  const [unitValue, setUnitValue] = useState(() => initialUnitValue(state, hasServingSize));
  const [editQuantityG, setEditQuantityG] = useState(() => initialEditGrams(state));
  const [mealType, setMealType] = useState<MealType>(() => initialMealType(state));
  const [tab, setTab] = useState<"summary" | "nutrients">("summary");

  // Add-portion sub-form + the just-added portion held optimistically until the
  // food-detail refetch (triggered by the mutation) surfaces it from the server.
  const [showAddPortion, setShowAddPortion] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGrams, setNewGrams] = useState("");
  const [extraServings, setExtraServings] = useState<FoodServing[]>([]);

  // Servings visible to the user (fetched + optimistic), de-duped by id, by grams.
  const mergedServings = useMemo<FoodServing[]>(() => {
    if (state.mode !== "create") return [];
    return computeMergedServings(servingsQuery.data?.servings ?? [], extraServings);
  }, [state.mode, servingsQuery.data, extraServings]);

  const unitOptions = useMemo<UnitOption[]>(() => {
    if (state.mode !== "create") return [{ value: "g", label: "grams", grams: 1 }];
    return computeUnitOptions(mergedServings, servingSizeG);
  }, [state.mode, mergedServings, servingSizeG]);

  // The user's own portions (non-null owner) are removable; shared USDA ones aren't.
  const personalServings = useMemo(
    () => mergedServings.filter((s) => s.createdByUserId != null),
    [mergedServings],
  );

  const selectedUnit = resolveSelectedUnit(unitOptions, unitValue, servingSizeG);
  const quantityG = isCreate ? count * (selectedUnit?.grams ?? 1) : editQuantityG;

  const preview =
    state.mode === "create"
      ? previewNutrition(state.food, quantityG)
      : scaleEntryPreview(state.entry, quantityG);
  const isPending = logFood.isPending || updateLog.isPending;
  const validQuantity = Number.isFinite(quantityG) && quantityG > 0;

  // Rich preview derived from the live serving (display only).
  const macroShares = macroEnergyShares(preview);
  const enrichedFood: Food | null =
    servingsQuery.data?.food ?? (state.mode === "create" ? state.food : null);
  const microRows = buildPreviewMicroRows(
    enrichedFood ? previewMicrosScaled(enrichedFood, quantityG) : {},
  );
  const goalRows = todayTotals
    ? projectGoalContribution(todayTotals, preview, effectiveTarget)
    : [];

  const handleUnitChange = (value: string) => {
    if (value === "__add") {
      setShowAddPortion(true);
      return; // keep the current unit; the sub-form drives the new selection
    }
    setUnitValue(value);
  };

  const portionGrams = parsePortionGrams(newGrams);
  const canAddPortion = newLabel.trim().length > 0 && portionGrams !== null;

  const handlePortionAdded = (created: FoodServing) => {
    setExtraServings((prev) => appendUnique(prev, created, (s) => s.id));
    setUnitValue(created.id);
    setCount(1);
    setShowAddPortion(false);
    setNewLabel("");
    setNewGrams("");
  };

  const handleAddPortion = () => {
    if (state.mode !== "create" || portionGrams === null || newLabel.trim().length === 0) return;
    addServing.mutate(
      { label: newLabel.trim(), grams: portionGrams },
      { onSuccess: handlePortionAdded },
    );
  };

  const handleRemovePortion = (serving: FoodServing) => {
    setExtraServings((prev) => prev.filter((s) => s.id !== serving.id));
    if (unitValue === serving.id) setUnitValue("g");
    removeServing.mutate(serving.id);
  };

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
      updateLog.mutate(
        { id: state.entry.id, data: { quantityG, mealType } },
        { onSuccess: onClose },
      );
    }
  };

  return (
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
            <Select value={selectedUnit?.value ?? "g"} onValueChange={handleUnitChange}>
              <SelectTrigger className="flex-1" data-testid="select-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unitOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="__add" data-testid="select-add-portion">
                  + Add portion…
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {selectedUnit && selectedUnit.value !== "g" && (
            <p className="text-xs text-muted-foreground">= {Math.round(quantityG)} g</p>
          )}

          {showAddPortion && (
            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs text-muted-foreground">New portion</p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="e.g. 1 slice"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  data-testid="input-portion-label"
                />
                <Input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  placeholder="grams"
                  className="w-24"
                  value={newGrams}
                  onChange={(e) => setNewGrams(e.target.value)}
                  data-testid="input-portion-grams"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddPortion(false);
                    setNewLabel("");
                    setNewGrams("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddPortion}
                  disabled={!canAddPortion || addServing.isPending}
                  data-testid="button-save-portion"
                >
                  Add
                </Button>
              </div>
            </div>
          )}

          {personalServings.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-muted-foreground">Your portions</p>
              {personalServings.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {s.label} · {Math.round(s.grams)} g
                  </span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          aria-label={`Remove ${s.label}`}
                          disabled={removeServing.isPending}
                          onClick={() => handleRemovePortion(s)}
                          data-testid="button-remove-portion"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Remove {s.label}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ))}
            </div>
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as "summary" | "nutrients")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="summary" data-testid="tab-summary">
            Summary
          </TabsTrigger>
          <TabsTrigger value="nutrients" data-testid="tab-nutrients">
            Nutrients
            {microRows.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4 pt-2">
          <div className="rounded-md bg-muted/40 p-3">
            <CalorieBreakdownRing shares={macroShares} calories={preview.calories} />
          </div>
          <MacroRows totals={preview} shares={macroShares} />
          <GoalContributionRows rows={goalRows} />
        </TabsContent>

        <TabsContent value="nutrients" className="pt-2">
          <MicronutrientPreviewPanel rows={microRows} isLoading={servingsQuery.isLoading} />
        </TabsContent>
      </Tabs>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background pt-3">
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
      </div>
    </div>
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
  todayTotals,
  effectiveTarget,
}: {
  readonly state: LogDialogState | null;
  readonly date: string;
  readonly onClose: () => void;
  readonly todayTotals?: NutritionMacroTotals | null;
  readonly effectiveTarget?: EffectiveTargetSummary | null;
}) {
  const formKey = getFormKey(state);

  return (
    <ResponsiveSheet
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={state?.mode === "edit" ? "Edit entry" : "Log food"}
      testId="dialog-log-food"
    >
      {state && (
        <LogFoodForm
          key={formKey}
          state={state}
          date={date}
          onClose={onClose}
          todayTotals={todayTotals ?? null}
          effectiveTarget={effectiveTarget ?? null}
        />
      )}
    </ResponsiveSheet>
  );
}
