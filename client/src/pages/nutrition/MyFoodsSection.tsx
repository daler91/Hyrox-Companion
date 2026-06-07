import type { Food } from "@shared/schema";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCustomFoods, useDeleteCustomFood, useDeleteRecipe, useRecipes } from "@/hooks/useNutrition";

/** Manage the user's custom foods and recipes (edit/delete). Logging happens via search. */
export function MyFoodsSection({
  onEditFood,
  onEditRecipe,
}: {
  readonly onEditFood: (food: Food) => void;
  readonly onEditRecipe: (id: string) => void;
}) {
  const { data: customFoods = [] } = useCustomFoods();
  const { data: recipes = [] } = useRecipes();
  const deleteFood = useDeleteCustomFood();
  const deleteRecipe = useDeleteRecipe();

  if (customFoods.length === 0 && recipes.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="my-foods-section">
      <h2 className="text-sm font-semibold">My foods &amp; recipes</h2>

      {recipes.length > 0 && (
        <div className="space-y-1">
          <p className="px-1 text-xs text-muted-foreground">Recipes</p>
          <ul className="divide-y rounded-md border">
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-sm">{r.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${r.name}`}
                    onClick={() => onEditRecipe(r.id)}
                    data-testid={`button-edit-recipe-${r.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${r.name}`}
                    disabled={deleteRecipe.isPending}
                    onClick={() => deleteRecipe.mutate(r.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {customFoods.length > 0 && (
        <div className="space-y-1">
          <p className="px-1 text-xs text-muted-foreground">Custom foods</p>
          <ul className="divide-y rounded-md border">
            {customFoods.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-sm">{f.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${f.name}`}
                    onClick={() => onEditFood(f)}
                    data-testid={`button-edit-food-${f.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${f.name}`}
                    disabled={deleteFood.isPending}
                    onClick={() => deleteFood.mutate(f.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
