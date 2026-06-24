import type { Food } from "@shared/schema";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCustomFoods,
  useDeleteCustomFood,
  useDeleteRecipe,
  useRecipes,
} from "@/hooks/useNutrition";

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
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "recipe" | "food";
    id: string;
    name: string;
  } | null>(null);

  if (customFoods.length === 0 && recipes.length === 0) return null;

  const isDeleting = deleteRecipe.isPending || deleteFood.isPending;

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
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => onEditRecipe(r.id)}
                          data-testid={`button-edit-recipe-${r.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit {r.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${r.name}`}
                          disabled={isDeleting}
                          onClick={() =>
                            setPendingDelete({ kind: "recipe", id: r.id, name: r.name })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete {r.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${f.name}`}
                          onClick={() => onEditFood(f)}
                          data-testid={`button-edit-food-${f.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit {f.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${f.name}`}
                          disabled={isDeleting}
                          onClick={() => setPendingDelete({ kind: "food", id: f.id, name: f.name })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete {f.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.kind === "recipe" ? "recipe" : "custom food"}?`}
        description={`"${pendingDelete?.name}" will be permanently deleted. This cannot be undone.`}
        confirmText="Delete"
        isDestructive
        isPending={isDeleting}
        onConfirm={() => {
          if (!pendingDelete) return;
          const opts = { onSettled: () => setPendingDelete(null) };
          if (pendingDelete.kind === "recipe") {
            deleteRecipe.mutate(pendingDelete.id, opts);
          } else {
            deleteFood.mutate(pendingDelete.id, opts);
          }
        }}
        confirmTestId="confirm-delete-my-food"
        cancelTestId="cancel-delete-my-food"
      />
    </section>
  );
}
