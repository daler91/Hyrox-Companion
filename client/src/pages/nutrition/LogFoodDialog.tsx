import { roundMacros, scaleNutrition } from "@shared/nutritionScaling";
import type {
  EffectiveTargetSummary,
  Food,
  FoodLogEntryWithNutrition,
  FoodServing,
  NutritionMacroTotals,
} from "@shared/schema";
import { MEAL_TYPES, type MealType } from "@shared/schema/enums";
import { Loader2, Trash2 } from "lucide-react";
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
  type PortionHint,
  useAddServing,
  useFoodWithServings,
  useLogFood,
  useRemoveServing,
  useUpdateLog,
} from "@/hooks/useNutrition";

import { CalorieBreakdownRing } from "./CalorieBreakdownRing";
import { FavoriteStarButton } from "./FavoriteStarButton";
import { GoalContributionRows } from "./GoalContributionRows";
import { MacroRows } from "./MacroRows";
import { MicronutrientPreviewPanel } from "./MicronutrientPreviewPanel";
import {
  appendUnique,
  buildPreviewMicroRows,
  defaultMealForNow,
  loggedAtForDate,
  macroEnergyShares,
  MEAL_LABELS,
  previewMicrosScaled,
  previewNutrition,
  projectGoalContribution,
} from "./utils";

/** Either creating a log from a searched/quick-add/barcode food, or editing an entry. */
export type LogDialogState =
  | {
    mode: "create";
    food: Food;
    entryMethod?: "manual" | "barcode";
    /** Last portion this food was logged in, when we have one (see usePortionMemory). */
    portionHint?: PortionHint;
    /** Explicit meal intent (e.g. a ?meal= deep-link) — beats the remembered meal. */
    mealOverride?: MealType;
  }
  | { mode: "edit"; entry: FoodLogEntryWithNutrition };

export interface UnitOption {
  value: string;
  label: string;
  grams: number;
}

/** Parse the add-portion grams field: a positive finite number, else null. */
function parsePortionGrams(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Nutrition for the edit preview, from the SAME raw inputs the server will use.
 *
 * This used to rescale `entry.nutrition`, which the server had already rounded,
 * and then round again — so the preview and the saved value disagreed. A 157 kcal
 * entry (rounded from 157.44) doubled previewed as 314 while the server stored
 * 315, and the gap widens with the factor (audit M22).
 */
function scaleEntryPreview(
  entry: FoodLogEntryWithNutrition,
  quantityG: number,
): NutritionMacroTotals {
  return roundMacros(scaleNutrition(entry.per100g, quantityG));
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

// A portion count only reads naturally in halves — "1.5 slices" is a sentence,
// "1.37 slices" is a rounding artefact. Counts above this are almost always a
// coincidence of arithmetic rather than how the athlete thinks about the food.
const PORTION_COUNT_STEP = 0.5;
const MAX_PORTION_COUNT = 20;
// Stored grams are rounded on the way in, so an exact division is too strict.
const PORTION_MATCH_TOLERANCE = 0.02;

/**
 * The named portion that best expresses `quantityG`, for re-opening a logged
 * entry in the units it was logged in ("2 slices", not "84 g").
 *
 * A portion qualifies when it divides the quantity into a near-whole (or half)
 * count; among those the largest portion wins, so 236 g of a food with both a
 * 118 g serving and a 59 g half reads as "2 servings" rather than "4 halves".
 * Falls back to grams when nothing lands cleanly — grams are always right, just
 * less friendly.
 */
export function matchPortionForGrams(
  quantityG: number,
  unitOptions: readonly UnitOption[],
): { unitValue: string; count: number } {
  let best: { unitValue: string; count: number; grams: number } | null = null;

  for (const option of unitOptions) {
    if (option.value === "g" || option.grams <= 0) continue;
    const raw = quantityG / option.grams;
    if (raw <= 0 || raw > MAX_PORTION_COUNT) continue;

    const snapped = Math.round(raw / PORTION_COUNT_STEP) * PORTION_COUNT_STEP;
    if (snapped <= 0) continue;
    if (Math.abs(raw - snapped) > snapped * PORTION_MATCH_TOLERANCE) continue;

    if (!best || option.grams > best.grams) {
      best = { unitValue: option.value, count: snapped, grams: option.grams };
    }
  }

  if (!best) return { unitValue: "g", count: Math.round(quantityG) };
  return { unitValue: best.unitValue, count: best.count };
}

/** Initial amount for a new log: the portion this food was last logged in,
 *  else 1 named serving (or 100 g). Edit mode seeds from the entry's grams
 *  instead, which needs the servings and so cannot be resolved here. */
function initialCount(state: LogDialogState, hasServingSize: boolean): number {
  if (state.mode !== "create") return 0;
  if (state.portionHint) return state.portionHint.quantityG;
  return hasServingSize ? 1 : 100;
}

/** Initial unit: grams when we are seeding a remembered portion, the synthetic
 *  "__serving" when a new food has a known serving, else grams.
 *
 *  A remembered portion is seeded in grams rather than mapped onto a named
 *  serving. The mapping itself is available (matchPortionForGrams), but this
 *  runs in a useState initializer, before useFoodWithServings has resolved —
 *  and unlike edit mode, a remembered portion has no stored quantity worth
 *  re-deriving once the servings land. */
function initialUnitValue(state: LogDialogState, hasServingSize: boolean): string {
  if (state.mode !== "create") return "g";
  if (state.portionHint) return "g";
  return hasServingSize ? "__serving" : "g";
}

/** Initial meal: an explicit override (deep-link intent) first, else the meal
 *  this food was last logged in, else the time-of-day default for a new log,
 *  else the entry's own meal. */
function initialMealType(state: LogDialogState): MealType {
  if (state.mode !== "create") return state.entry.mealType;
  return state.mealOverride ?? state.portionHint?.mealType ?? defaultMealForNow();
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
    foodId: entry.foodId,
    detailFoodId: entry.foodId,
    // The entry payload carries grams only; the food's default serving arrives
    // with the food detail, so the caller folds it in once that resolves.
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
  const { foodId, detailFoodId, servingSizeG: stateServingSizeG, name, brand } = deriveFoodFields(state);

  // Food + named servings. Fetched in both modes: both use the servings for the
  // unit selector, and both use the enriched food (USDA micros are filled in on
  // first detail fetch) for the micronutrient preview.
  const servingsQuery = useFoodWithServings(detailFoodId);
  const addServing = useAddServing(foodId);
  const removeServing = useRemoveServing(foodId);

  // Edit mode has no serving size to seed from up front — it rides in on the
  // food detail alongside the named servings.
  const servingSizeG = stateServingSizeG ?? servingsQuery.data?.food.servingSizeG ?? null;
  const hasServingSize = servingSizeG != null && servingSizeG > 0;

  // Both modes drive quantity as a count + a unit (grams / named portion).
  //
  // Create mode can seed synchronously: the synthetic "__serving" option is
  // derivable from the picked food, so there's no flash before the named
  // servings load. Edit mode cannot — matching the entry's grams back onto
  // "2 slices" needs the servings, which arrive after first render. So both
  // fields stay null until the athlete touches them and the seed is *derived*
  // below. That resolves late without an effect, and without stomping typed
  // input when useAddServing invalidates the food-detail query.
  const [countInput, setCountInput] = useState<number | null>(() =>
    isCreate ? initialCount(state, hasServingSize) : null,
  );
  const [unitInput, setUnitInput] = useState<string | null>(() =>
    isCreate ? initialUnitValue(state, hasServingSize) : null,
  );
  const [mealType, setMealType] = useState<MealType>(() => initialMealType(state));
  const [tab, setTab] = useState<"summary" | "nutrients">("summary");

  // Add-portion sub-form + the just-added portion held optimistically until the
  // food-detail refetch (triggered by the mutation) surfaces it from the server.
  const [showAddPortion, setShowAddPortion] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGrams, setNewGrams] = useState("");
  const [extraServings, setExtraServings] = useState<FoodServing[]>([]);

  // Servings visible to the user (fetched + optimistic), de-duped by id, by grams.
  const mergedServings = useMemo<FoodServing[]>(
    () => computeMergedServings(servingsQuery.data?.servings ?? [], extraServings),
    [servingsQuery.data, extraServings],
  );

  const unitOptions = useMemo<UnitOption[]>(
    () => computeUnitOptions(mergedServings, servingSizeG),
    [mergedServings, servingSizeG],
  );

  // Edit mode's seed: the entry's stored grams re-expressed in the friendliest
  // named portion available, recomputed as servings arrive. Untouched fields
  // fall back to it; once the athlete edits either, their value wins for good.
  const editSeed = useMemo(
    () => (state.mode === "edit" ? matchPortionForGrams(state.entry.quantityG, unitOptions) : null),
    [state, unitOptions],
  );
  const count = countInput ?? editSeed?.count ?? 0;
  const unitValue = unitInput ?? editSeed?.unitValue ?? "g";

  // The user's own portions (non-null owner) are removable; shared USDA ones aren't.
  const personalServings = useMemo(
    () => mergedServings.filter((s) => s.createdByUserId != null),
    [mergedServings],
  );

  const selectedUnit = resolveSelectedUnit(unitOptions, unitValue, servingSizeG);
  const quantityG = count * (selectedUnit?.grams ?? 1);

  const preview =
    state.mode === "create"
      ? previewNutrition(state.food, quantityG)
      : scaleEntryPreview(state.entry, quantityG);
  const isPending = logFood.isPending || updateLog.isPending;
  const validQuantity = Number.isFinite(quantityG) && quantityG > 0;
  const idleLabel = isCreate ? "Log it" : "Save";
  const busyLabel = isCreate ? "Logging…" : "Saving…";
  const submitLabel = isPending ? busyLabel : idleLabel;

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
    // Pin the count alongside the unit. Changing units keeps the count and
    // recomputes grams (the long-standing create-mode behaviour); leaving the
    // count derived would let it re-resolve against the new unit and quietly
    // reinterpret "2 slices" as "2 grams".
    setCountInput(count);
    setUnitInput(value);
  };

  const portionGrams = parsePortionGrams(newGrams);
  const canAddPortion = newLabel.trim().length > 0 && portionGrams !== null;

  const handlePortionAdded = (created: FoodServing) => {
    setExtraServings((prev) => appendUnique(prev, created, (s) => s.id));
    setUnitInput(created.id);
    setCountInput(1);
    setShowAddPortion(false);
    setNewLabel("");
    setNewGrams("");
  };

  const handleAddPortion = () => {
    if (portionGrams === null || newLabel.trim().length === 0) return;
    addServing.mutate(
      { label: newLabel.trim(), grams: portionGrams },
      { onSuccess: handlePortionAdded },
    );
  };

  const handleRemovePortion = (serving: FoodServing) => {
    setExtraServings((prev) => prev.filter((s) => s.id !== serving.id));
    // Pin the current amount before the option list shrinks — otherwise an
    // untouched edit-mode seed re-derives onto a different portion behind the
    // athlete the moment this serving disappears. When the portion being
    // removed is the selected one, fall back to grams carrying the same
    // quantity rather than reinterpreting the count as grams.
    if (unitValue === serving.id) {
      setCountInput(Math.round(quantityG));
      setUnitInput("g");
    } else {
      setCountInput(count);
      setUnitInput(unitValue);
    }
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {brand && <p className="truncate text-sm text-muted-foreground">{brand}</p>}
        </div>
        <FavoriteStarButton foodId={detailFoodId} foodName={name} size="sm" />
      </div>

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
            onChange={(e) => setCountInput(Number(e.target.value))}
            data-testid="input-quantity"
          />
          <Select value={selectedUnit?.value ?? "g"} onValueChange={handleUnitChange}>
            <SelectTrigger className="flex-1" aria-label="Unit" data-testid="select-unit">
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
                aria-label="Portion label"
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
                aria-label="Portion size in grams"
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
                aria-busy={addServing.isPending}
                data-testid="button-save-portion"
              >
                {addServing.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                )}
                {addServing.isPending ? "Adding…" : "Add"}
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
          aria-busy={isPending}
          data-testid="button-submit-log"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
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
