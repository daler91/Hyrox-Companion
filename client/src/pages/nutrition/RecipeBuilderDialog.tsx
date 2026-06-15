import type { Food, NutritionMacroTotals, RecipeWithIngredients } from "@shared/schema";
import { Trash2 } from "lucide-react";
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCreateRecipe, useRecipe, useUpdateRecipe } from "@/hooks/useNutrition";

import { FoodSearch } from "./FoodSearch";
import { removeAt, updateAt } from "./utils";

interface Ingredient {
  foodId: string;
  name: string;
  quantityG: number;
  per100: NutritionMacroTotals;
}

function per100From(food: Food): NutritionMacroTotals {
  return {
    calories: food.caloriesPer100g ?? 0,
    protein: food.proteinPer100g ?? 0,
    carb: food.carbPer100g ?? 0,
    fat: food.fatPer100g ?? 0,
    fiber: food.fiberPer100g ?? 0,
  };
}

/** Recover per-100g values from a saved ingredient's nutrition at its quantity. */
function per100FromNutrition(n: NutritionMacroTotals, quantityG: number): NutritionMacroTotals {
  const f = quantityG > 0 ? 100 / quantityG : 0;
  return {
    calories: n.calories * f,
    protein: n.protein * f,
    carb: n.carb * f,
    fat: n.fat * f,
    fiber: n.fiber * f,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function RecipeBuilderForm({
  initial,
  onClose,
}: {
  readonly initial: RecipeWithIngredients | null;
  readonly onClose: () => void;
}) {
  const createRecipe = useCreateRecipe();
  const updateRecipe = useUpdateRecipe();

  const [name, setName] = useState(initial?.name ?? "");
  const [servings, setServings] = useState(initial ? String(initial.servings) : "1");
  const [ingredients, setIngredients] = useState<Ingredient[]>(() =>
    initial
      ? initial.ingredients.map((i) => ({
          foodId: i.foodId,
          name: i.name,
          quantityG: i.quantityG,
          per100: per100FromNutrition(i.nutrition, i.quantityG),
        }))
      : [],
  );

  const isPending = createRecipe.isPending || updateRecipe.isPending;
  const servingsNum = Number(servings);
  const valid = name.trim().length > 0 && ingredients.length > 0 && servingsNum > 0;

  const totals = ingredients.reduce<NutritionMacroTotals>(
    (acc, ing) => {
      const factor = ing.quantityG / 100;
      acc.calories += ing.per100.calories * factor;
      acc.protein += ing.per100.protein * factor;
      acc.carb += ing.per100.carb * factor;
      acc.fat += ing.per100.fat * factor;
      acc.fiber += ing.per100.fiber * factor;
      return acc;
    },
    { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 },
  );
  const divisor = servingsNum > 0 ? servingsNum : 1;

  const addFood = (food: Food) => {
    setIngredients((prev) => [
      ...prev,
      {
        foodId: food.id,
        name: food.name,
        quantityG: Math.round(food.servingSizeG ?? 100),
        per100: per100From(food),
      },
    ]);
  };

  const updateIngredient = (i: number, patch: Partial<Ingredient>) =>
    setIngredients((prev) => updateAt(prev, i, patch));
  const removeIngredient = (i: number) => setIngredients((prev) => removeAt(prev, i));

  const submit = () => {
    if (!valid) return;
    const payload = {
      name: name.trim(),
      servings: servingsNum,
      ingredients: ingredients.map((i) => ({ foodId: i.foodId, quantityG: i.quantityG })),
    };
    if (initial) {
      updateRecipe.mutate({ id: initial.id, data: payload }, { onSuccess: onClose });
    } else {
      createRecipe.mutate(payload, { onSuccess: onClose });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{initial ? "Edit recipe" : "New recipe"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="recipe-name">Name</Label>
            <Input
              id="recipe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-recipe-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recipe-servings">Servings</Label>
            <Input
              id="recipe-servings"
              type="number"
              min={1}
              inputMode="decimal"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              data-testid="input-recipe-servings"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Ingredients</p>
          {ingredients.length === 0 && (
            <p className="text-sm text-muted-foreground">Search below to add ingredients.</p>
          )}
          {ingredients.map((ing, i) => (
            <div key={ing.foodId + i} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{ing.name}</span>
              <Input
                type="number"
                min={1}
                className="w-24"
                value={ing.quantityG}
                onChange={(e) => updateIngredient(i, { quantityG: Number(e.target.value) })}
                data-testid={`input-ingredient-qty-${i}`}
              />
              <span className="w-10 text-right text-xs text-muted-foreground">g</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${ing.name}`}
                onClick={() => removeIngredient(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <FoodSearch onSelect={addFood} />
        </div>

        <div className="grid grid-cols-5 gap-2 rounded-md bg-muted/40 p-3 text-center">
          <PreviewCell
            label="kcal"
            value={Math.round(totals.calories / divisor)}
            testid="recipe-preview-calories"
          />
          <PreviewCell
            label="P"
            value={round1(totals.protein / divisor)}
            testid="recipe-preview-protein"
          />
          <PreviewCell
            label="C"
            value={round1(totals.carb / divisor)}
            testid="recipe-preview-carb"
          />
          <PreviewCell label="F" value={round1(totals.fat / divisor)} testid="recipe-preview-fat" />
          <PreviewCell
            label="Fib"
            value={round1(totals.fiber / divisor)}
            testid="recipe-preview-fiber"
          />
        </div>
        <p className="text-center text-[10px] text-muted-foreground">per serving</p>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid || isPending} data-testid="button-save-recipe">
          {initial ? "Save" : "Create recipe"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PreviewCell({
  label,
  value,
  testid,
}: {
  readonly label: string;
  readonly value: number;
  readonly testid: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums" data-testid={testid}>
        {value}
      </div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

export function RecipeBuilderDialog({
  open,
  recipeId,
  onClose,
}: {
  readonly open: boolean;
  readonly recipeId: string | null;
  readonly onClose: () => void;
}) {
  const recipeQuery = useRecipe(open ? recipeId : null);
  const ready = !recipeId || recipeQuery.data !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="dialog-recipe">
        {ready ? (
          <RecipeBuilderForm
            key={recipeId ?? "create"}
            initial={recipeQuery.data ?? null}
            onClose={onClose}
          />
        ) : (
          <div className="flex justify-center p-6">
            <LoadingSpinner />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
