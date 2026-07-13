import type { Food, ParseLabelResponse } from "@shared/schema";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCreateCustomFood, useUpdateCustomFood } from "@/hooks/useNutrition";

import { removeAt, updateAt } from "./utils";

export type CustomFoodDialogState =
  // `prefill` carries a scanned nutrition label (label-scan flow): the form is
  // seeded from its per-100g suggestion for review before saving.
  | { mode: "create"; prefill?: ParseLabelResponse }
  | { mode: "edit"; food: Food };

type ServingDraft = { id: string; label: string; grams: string };

const MACRO_FIELDS = [
  { field: "caloriesPer100g", label: "Calories" },
  { field: "proteinPer100g", label: "Protein (g)" },
  { field: "carbPer100g", label: "Carbs (g)" },
  { field: "fatPer100g", label: "Fat (g)" },
  { field: "fiberPer100g", label: "Fiber (g)" },
] as const;

type MacroKey = (typeof MACRO_FIELDS)[number]["field"];

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

function CustomFoodForm({
  state,
  onClose,
  onCreated,
}: {
  readonly state: CustomFoodDialogState;
  readonly onClose: () => void;
  readonly onCreated?: (food: Food) => void;
}) {
  const isCreate = state.mode === "create";
  const food = isCreate ? null : state.food;
  const prefill = isCreate ? (state.prefill ?? null) : null;
  const suggestion = prefill?.suggestion ?? null;
  const createFood = useCreateCustomFood();
  const updateFood = useUpdateCustomFood();

  const [name, setName] = useState(food?.name ?? suggestion?.name ?? "");
  const [brand, setBrand] = useState(food?.brand ?? suggestion?.brand ?? "");
  const [macros, setMacros] = useState<Record<MacroKey, string>>(() => ({
    caloriesPer100g: numToStr(food?.caloriesPer100g ?? suggestion?.caloriesPer100g),
    proteinPer100g: numToStr(food?.proteinPer100g ?? suggestion?.proteinPer100g),
    carbPer100g: numToStr(food?.carbPer100g ?? suggestion?.carbPer100g),
    fatPer100g: numToStr(food?.fatPer100g ?? suggestion?.fatPer100g),
    fiberPer100g: numToStr(food?.fiberPer100g ?? suggestion?.fiberPer100g),
  }));
  const [servingSizeG, setServingSizeG] = useState(
    numToStr(food?.servingSizeG ?? suggestion?.servingSizeG),
  );
  const [servings, setServings] = useState<ServingDraft[]>([]);

  const isPending = createFood.isPending || updateFood.isPending;
  const valid = name.trim().length > 0;

  // A per-serving-only label with no gram weight can't be normalized to
  // per-100g, so the suggestion arrives empty — show the printed per-serving
  // values read-only for the user to convert by hand.
  const perServing =
    suggestion &&
    MACRO_FIELDS.every((m) => suggestion[m.field] == null) &&
    prefill?.label?.perServing != null
      ? prefill.label.perServing
      : null;

  let title = "Edit custom food";
  if (prefill) title = "Review label";
  else if (isCreate) title = "New custom food";

  let saveLabel = "Save";
  if (isPending) saveLabel = "Saving…";
  else if (isCreate) saveLabel = "Save food";

  const submit = (logAfter = false) => {
    if (!valid) return;
    const fields = {
      name: name.trim(),
      brand: brand.trim() || null,
      caloriesPer100g: parseNum(macros.caloriesPer100g),
      proteinPer100g: parseNum(macros.proteinPer100g),
      carbPer100g: parseNum(macros.carbPer100g),
      fatPer100g: parseNum(macros.fatPer100g),
      fiberPer100g: parseNum(macros.fiberPer100g),
      servingSizeG: parseNum(servingSizeG),
    };
    if (isCreate) {
      const cleanServings = servings
        .map((s) => ({ label: s.label.trim(), grams: parseNum(s.grams) }))
        .filter(
          (s): s is { label: string; grams: number } =>
            s.label.length > 0 && s.grams !== null && s.grams > 0,
        );
      createFood.mutate(
        { ...fields, servings: cleanServings.length > 0 ? cleanServings : undefined },
        {
          onSuccess: (created) => {
            onClose();
            if (logAfter) onCreated?.(created);
          },
        },
      );
    } else if (food) {
      updateFood.mutate({ id: food.id, data: fields }, { onSuccess: onClose });
    }
  };

  const addServingRow = () =>
    setServings((prev) => [...prev, { id: crypto.randomUUID(), label: "", grams: "" }]);
  const updateServing = (i: number, patch: Partial<ServingDraft>) =>
    setServings((prev) => updateAt(prev, i, patch));
  const removeServing = (i: number) => setServings((prev) => removeAt(prev, i));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {prefill && (
          <div
            className="space-y-1 rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground"
            data-testid="label-prefill-banner"
          >
            <p>Read from the label photo — check the values against the package before saving.</p>
            {prefill.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
        {perServing && (
          <div
            className="rounded-md border p-3 text-xs"
            data-testid="label-per-serving-values"
          >
            <p className="mb-1 font-medium">
              Printed per serving
              {prefill?.label?.servingSizeText ? ` (${prefill.label.servingSizeText})` : ""}
            </p>
            <p className="text-muted-foreground">
              {[
                perServing.calories != null && `${perServing.calories} kcal`,
                perServing.protein != null && `${perServing.protein} g protein`,
                perServing.carb != null && `${perServing.carb} g carbs`,
                perServing.fat != null && `${perServing.fat} g fat`,
                perServing.fiber != null && `${perServing.fiber} g fiber`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="cf-name">Name</Label>
          <Input
            id="cf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-custom-name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-brand">Brand (optional)</Label>
          <Input
            id="cf-brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            data-testid="input-custom-brand"
          />
        </div>

        <p className="text-xs text-muted-foreground">Nutrition per 100 g</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MACRO_FIELDS.map((m) => (
            <div key={m.field} className="space-y-1">
              <Label htmlFor={`cf-${m.field}`} className="text-xs">
                {m.label}
              </Label>
              <Input
                id={`cf-${m.field}`}
                type="number"
                min={0}
                inputMode="decimal"
                value={macros[m.field]}
                onChange={(e) => setMacros((prev) => ({ ...prev, [m.field]: e.target.value }))}
                data-testid={`input-custom-${m.field}`}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="cf-serving" className="text-xs">
              Serving (g)
            </Label>
            <Input
              id="cf-serving"
              type="number"
              min={0}
              inputMode="decimal"
              value={servingSizeG}
              onChange={(e) => setServingSizeG(e.target.value)}
              data-testid="input-custom-serving"
            />
          </div>
        </div>

        {isCreate && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Named servings (optional)</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addServingRow}
                data-testid="button-add-serving"
              >
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
            {servings.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <Input
                  placeholder="e.g. 1 cup"
                  aria-label={`Serving ${i + 1} name`}
                  value={s.label}
                  onChange={(e) => updateServing(i, { label: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="grams"
                  aria-label={`Serving ${i + 1} weight in grams`}
                  className="w-24"
                  value={s.grams}
                  onChange={(e) => updateServing(i, { grams: e.target.value })}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove serving"
                        onClick={() => removeServing(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Remove serving</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => submit()}
          disabled={!valid || isPending}
          aria-busy={isPending}
          data-testid="button-save-custom-food"
          variant={prefill ? "outline" : "default"}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {saveLabel}
        </Button>
        {prefill && (
          <Button
            onClick={() => submit(true)}
            disabled={!valid || isPending}
            aria-busy={isPending}
            data-testid="button-save-and-log-custom-food"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Save &amp; log
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export function CustomFoodDialog({
  state,
  onClose,
  onCreated,
}: {
  readonly state: CustomFoodDialogState | null;
  readonly onClose: () => void;
  /** Called after "Save & log" (label-scan flow) with the newly created food. */
  readonly onCreated?: (food: Food) => void;
}) {
  const key = state?.mode === "edit" ? `edit:${state.food.id}` : "create";
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent data-testid="dialog-custom-food">
        {state && <CustomFoodForm key={key} state={state} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}
