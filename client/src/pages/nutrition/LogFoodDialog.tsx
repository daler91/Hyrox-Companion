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
import { useLogTimezoneSync } from "./useLogTimezoneSync";
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

/** The serving an edit replaces: the entry as saved, which today's totals
 *  already count (CL32, CODEBASE_ANALYSIS_2026-10-03). None for a new log. */
function replacedServing(state: LogDialogState): NutritionMacroTotals | undefined {
  return state.mode === "edit" ? scaleEntryPreview(state.entry, state.entry.quantityG) : undefined;
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

  // Grams to one decimal, as stored: whole grams showed a 7.5 g entry as 8 g.
  if (!best) return { unitValue: "g", count: Math.round(quantityG * 10) / 10 };
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
 * The amount being logged, as a count of a unit (grams or a named portion).
 *
 * Create mode can seed synchronously: the synthetic "__serving" option is
 * derivable from the picked food, so there's no flash before the named
 * servings load. Edit mode cannot — matching the entry's grams back onto
 * "2 slices" needs the servings, which arrive after first render. So both
 * fields stay null until the athlete touches them and the seed is *derived*
 * below. That resolves late without an effect, and without stomping typed
 * input when useAddServing invalidates the food-detail query.
 */
function useLogAmount(
  state: LogDialogState,
  unitOptions: readonly UnitOption[],
  servingSizeG: number | null,
) {
  const isCreate = state.mode === "create";
  const hasServingSize = servingSizeG != null && servingSizeG > 0;
  const [countInput, setCountInput] = useState<number | null>(() =>
    isCreate ? initialCount(state, hasServingSize) : null,
  );
  const [unitInput, setUnitInput] = useState<string | null>(() =>
    isCreate ? initialUnitValue(state, hasServingSize) : null,
  );
  // Whether the athlete has changed the amount (count or unit). An untouched
  // edit keeps the entry's stored grams: the seed below re-expresses them as a
  // friendly portion, and saving that snapped count turned 240 g into 236 g
  // (and 7.5 g into 8 g) when only the meal was changed.
  // CL63 (CODEBASE_ANALYSIS_2026-10-03)
  const [amountEdited, setAmountEdited] = useState(false);

  // Edit mode's seed: the entry's stored grams re-expressed in the friendliest
  // named portion available, recomputed as servings arrive. Untouched fields
  // fall back to it; once the athlete edits either, their value wins for good.
  const editSeed = useMemo(
    () => (state.mode === "edit" ? matchPortionForGrams(state.entry.quantityG, unitOptions) : null),
    [state, unitOptions],
  );
  const count = countInput ?? editSeed?.count ?? 0;
  const unitValue = unitInput ?? editSeed?.unitValue ?? "g";

  const selectedUnit = resolveSelectedUnit(unitOptions, unitValue, servingSizeG);
  const quantityG =
    state.mode === "edit" && !amountEdited
      ? state.entry.quantityG
      : count * (selectedUnit?.grams ?? 1);

  /** Hold the shown amount without counting it as the athlete's change. */
  const pinAmount = (nextCount: number, nextUnit: string) => {
    setCountInput(nextCount);
    setUnitInput(nextUnit);
  };
  /** The athlete typed a count; the unit stays as it resolves. */
  const editCount = (nextCount: number) => {
    setCountInput(nextCount);
    setAmountEdited(true);
  };
  /** The athlete chose a count and unit together. */
  const editAmount = (nextCount: number, nextUnit: string) => {
    pinAmount(nextCount, nextUnit);
    setAmountEdited(true);
  };

  return {
    count,
    unitValue,
    selectedUnit,
    quantityG,
    amountEdited,
    pinAmount,
    editCount,
    editAmount,
  };
}

/** The "+ Add portion…" sub-form: a label and its grams, saved as a named
 *  serving of the food. Unmounting it (cancel or saved) clears its fields. */
function AddPortionForm({
  foodId,
  onAdded,
  onCancel,
}: {
  readonly foodId: string;
  readonly onAdded: (created: FoodServing) => void;
  readonly onCancel: () => void;
}) {
  const addServing = useAddServing(foodId);
  const [label, setLabel] = useState("");
  const [grams, setGrams] = useState("");
  const portionGrams = parsePortionGrams(grams);
  const trimmedLabel = label.trim();

  const handleAdd = () => {
    if (portionGrams === null || trimmedLabel.length === 0) return;
    addServing.mutate({ label: trimmedLabel, grams: portionGrams }, { onSuccess: onAdded });
  };

  return (
    <div className="space-y-2 rounded-md border p-2">
      <p className="text-xs text-muted-foreground">New portion</p>
      <div className="flex items-center gap-2">
        <Input
          placeholder="e.g. 1 slice"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
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
          value={grams}
          onChange={(e) => {
            setGrams(e.target.value);
          }}
          aria-label="Portion size in grams"
          data-testid="input-portion-grams"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={trimmedLabel.length === 0 || portionGrams === null || addServing.isPending}
          aria-busy={addServing.isPending}
          data-testid="button-save-portion"
        >
          {addServing.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {addServing.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}

/** The athlete's own portions of this food, each removable. */
function PersonalPortions({
  servings,
  disabled,
  onRemove,
}: {
  readonly servings: readonly FoodServing[];
  readonly disabled: boolean;
  readonly onRemove: (serving: FoodServing) => void;
}) {
  if (servings.length === 0) return null;
  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs text-muted-foreground">Your portions</p>
      {servings.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-sm"
        >
          <span className="min-w-0 truncate">
            {s.label} · {Math.round(s.grams)} g
          </span>
          <RemovePortionButton serving={s} disabled={disabled} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

/** One portion's remove button, with a tooltip naming the portion. */
function RemovePortionButton({
  serving,
  disabled,
  onRemove,
}: {
  readonly serving: FoodServing;
  readonly disabled: boolean;
  readonly onRemove: (serving: FoodServing) => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            // 44px on phones, like every icon button: deleting a saved
            // portion should not be a thumb slip. U26 (CODEBASE_ANALYSIS_2026-10-03)
            className="shrink-0 md:h-7 md:w-7"
            aria-label={`Remove ${serving.label}`}
            disabled={disabled}
            onClick={() => {
              onRemove(serving);
            }}
            data-testid="button-remove-portion"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Remove {serving.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Summary + Nutrients tabs: the live serving's macros, its effect on the
 *  day's goals and its micronutrients (display only). */
function LogPreviewTabs({
  state,
  quantityG,
  detailFood,
  microsLoading,
  todayTotals,
  effectiveTarget,
}: {
  readonly state: LogDialogState;
  readonly quantityG: number;
  /** The food as the detail fetch enriched it (USDA micros), once it lands. */
  readonly detailFood: Food | null;
  readonly microsLoading: boolean;
  readonly todayTotals: NutritionMacroTotals | null;
  readonly effectiveTarget: EffectiveTargetSummary | null;
}) {
  const [tab, setTab] = useState<"summary" | "nutrients">("summary");

  const preview =
    state.mode === "create"
      ? previewNutrition(state.food, quantityG)
      : scaleEntryPreview(state.entry, quantityG);
  const macroShares = macroEnergyShares(preview);
  const enrichedFood = detailFood ?? (state.mode === "create" ? state.food : null);
  const microRows = buildPreviewMicroRows(
    enrichedFood ? previewMicrosScaled(enrichedFood, quantityG) : {},
  );
  const goalRows = todayTotals
    ? projectGoalContribution(todayTotals, preview, effectiveTarget, replacedServing(state))
    : [];

  return (
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
        <MicronutrientPreviewPanel rows={microRows} isLoading={microsLoading} />
      </TabsContent>
    </Tabs>
  );
}

/** The submit button's label for the mode and whether a save is under way. */
function submitLabelFor(isCreate: boolean, isPending: boolean): string {
  if (isCreate) return isPending ? "Logging…" : "Log it";
  return isPending ? "Saving…" : "Save";
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
  const { runSynced, isSyncing } = useLogTimezoneSync();
  const isCreate = state.mode === "create";
  const { foodId, detailFoodId, servingSizeG: stateServingSizeG, name, brand } = deriveFoodFields(state);

  // Food + named servings. Fetched in both modes: both use the servings for the
  // unit selector, and both use the enriched food (USDA micros are filled in on
  // first detail fetch) for the micronutrient preview.
  const servingsQuery = useFoodWithServings(detailFoodId);
  const removeServing = useRemoveServing(foodId);
  const detailFood = servingsQuery.data?.food ?? null;

  // Edit mode has no serving size to seed from up front — it rides in on the
  // food detail alongside the named servings.
  const servingSizeG = stateServingSizeG ?? detailFood?.servingSizeG ?? null;

  const [mealType, setMealType] = useState<MealType>(() => initialMealType(state));

  // Add-portion sub-form + the just-added portion held optimistically until the
  // food-detail refetch (triggered by the mutation) surfaces it from the server.
  const [showAddPortion, setShowAddPortion] = useState(false);
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

  // Both modes drive quantity as a count + a unit (grams / named portion).
  const amount = useLogAmount(state, unitOptions, servingSizeG);
  const { count, unitValue, selectedUnit, quantityG } = amount;

  // The user's own portions (non-null owner) are removable; shared USDA ones aren't.
  const personalServings = useMemo(
    () => mergedServings.filter((s) => s.createdByUserId != null),
    [mergedServings],
  );

  const isPending = logFood.isPending || updateLog.isPending || isSyncing;
  const validQuantity = Number.isFinite(quantityG) && quantityG > 0;

  const handleUnitChange = (value: string) => {
    if (value === "__add") {
      setShowAddPortion(true);
      return; // keep the current unit; the sub-form drives the new selection
    }
    // Pin the count alongside the unit. Changing units keeps the count and
    // recomputes grams (the long-standing create-mode behaviour); leaving the
    // count derived would let it re-resolve against the new unit and quietly
    // reinterpret "2 slices" as "2 grams".
    amount.editAmount(count, value);
  };

  const handlePortionAdded = (created: FoodServing) => {
    setExtraServings((prev) => appendUnique(prev, created, (s) => s.id));
    amount.editAmount(1, created.id);
    setShowAddPortion(false);
  };

  const handleRemovePortion = (serving: FoodServing) => {
    setExtraServings((prev) => prev.filter((s) => s.id !== serving.id));
    // Pin the current amount before the option list shrinks — otherwise an
    // untouched edit-mode seed re-derives onto a different portion behind the
    // athlete the moment this serving disappears. When the portion being
    // removed is the selected one, fall back to grams carrying the same
    // quantity rather than reinterpreting the count as grams.
    if (unitValue === serving.id) {
      amount.pinAmount(Math.round(quantityG), "g");
    } else {
      amount.pinAmount(count, unitValue);
    }
    removeServing.mutate(serving.id);
  };

  const handleSubmit = () => {
    if (!validQuantity) return;
    if (state.mode === "create") {
      const { food, entryMethod } = state;
      // The server dates a new entry by the profile's timezone (CL65).
      runSynced(() => {
        logFood.mutate(
          { foodId: food.id, quantityG, mealType, loggedAt: loggedAtForDate(date), entryMethod },
          { onSuccess: onClose },
        );
      });
    } else {
      // An untouched amount is left out, so the stored grams stand (CL63).
      updateLog.mutate(
        { id: state.entry.id, data: amount.amountEdited ? { quantityG, mealType } : { mealType } },
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
            onChange={(e) => {
              amount.editCount(Number(e.target.value));
            }}
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
          <AddPortionForm
            foodId={foodId}
            onAdded={handlePortionAdded}
            onCancel={() => {
              setShowAddPortion(false);
            }}
          />
        )}

        <PersonalPortions
          servings={personalServings}
          disabled={removeServing.isPending}
          onRemove={handleRemovePortion}
        />
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

      <LogPreviewTabs
        state={state}
        quantityG={quantityG}
        detailFood={detailFood}
        microsLoading={servingsQuery.isLoading}
        todayTotals={todayTotals}
        effectiveTarget={effectiveTarget}
      />

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
          {submitLabelFor(isCreate, isPending)}
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
