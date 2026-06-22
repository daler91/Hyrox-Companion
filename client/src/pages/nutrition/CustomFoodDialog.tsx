import type { Food } from "@shared/schema";
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
import { useCreateCustomFood, useUpdateCustomFood } from "@/hooks/useNutrition";

import { removeAt, updateAt } from "./utils";

export type CustomFoodDialogState = { mode: "create" } | { mode: "edit"; food: Food };

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
}: {
  readonly state: CustomFoodDialogState;
  readonly onClose: () => void;
}) {
  const isCreate = state.mode === "create";
  const food = isCreate ? null : state.food;
  const createFood = useCreateCustomFood();
  const updateFood = useUpdateCustomFood();

  const [name, setName] = useState(food?.name ?? "");
  const [brand, setBrand] = useState(food?.brand ?? "");
  const [macros, setMacros] = useState<Record<MacroKey, string>>(() => ({
    caloriesPer100g: numToStr(food?.caloriesPer100g),
    proteinPer100g: numToStr(food?.proteinPer100g),
    carbPer100g: numToStr(food?.carbPer100g),
    fatPer100g: numToStr(food?.fatPer100g),
    fiberPer100g: numToStr(food?.fiberPer100g),
  }));
  const [servingSizeG, setServingSizeG] = useState(numToStr(food?.servingSizeG));
  const [servings, setServings] = useState<ServingDraft[]>([]);

  const isPending = createFood.isPending || updateFood.isPending;
  const valid = name.trim().length > 0;

  const submit = () => {
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
        { onSuccess: onClose },
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
        <DialogTitle>{isCreate ? "New custom food" : "Edit custom food"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove serving"
                  onClick={() => removeServing(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
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
          onClick={submit}
          disabled={!valid || isPending}
          aria-busy={isPending}
          data-testid="button-save-custom-food"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {isPending ? "Saving…" : isCreate ? "Save food" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function CustomFoodDialog({
  state,
  onClose,
}: {
  readonly state: CustomFoodDialogState | null;
  readonly onClose: () => void;
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
        {state && <CustomFoodForm key={key} state={state} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
