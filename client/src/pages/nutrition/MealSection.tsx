import type { FoodLogEntryWithNutrition } from "@shared/schema";
import { Pencil, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MealSectionProps {
  readonly label: string;
  readonly entries: readonly FoodLogEntryWithNutrition[];
  readonly onEdit: (entry: FoodLogEntryWithNutrition) => void;
  readonly onDelete: (id: string) => void;
  readonly deletingId?: string;
}

/** One meal's logged entries with edit/delete (FR-1.6). Hidden when empty. */
export function MealSection({ label, entries, onEdit, onDelete, deletingId }: MealSectionProps) {
  if (entries.length === 0) return null;
  const calories = entries.reduce((sum, e) => sum + e.nutrition.calories, 0);

  return (
    <section data-testid={`meal-section-${label.toLowerCase()}`}>
      <header className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{calories} kcal</span>
      </header>
      <ul className="mt-1 divide-y rounded-md border">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {e.name}
                {(e.entryMethod === "nl" || e.entryMethod === "photo") && (
                  <Sparkles
                    className="ml-1 inline h-3 w-3 align-baseline text-primary"
                    aria-label="Logged with AI"
                    data-testid={`ai-badge-${e.id}`}
                  />
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {Math.round(e.quantityG)} g · {e.nutrition.calories} kcal · P{e.nutrition.protein} C
                {e.nutrition.carb} F{e.nutrition.fat}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${e.name}`}
                      onClick={() => onEdit(e)}
                      data-testid={`button-edit-${e.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Edit {e.name}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${e.name}`}
                      onClick={() => onDelete(e.id)}
                      disabled={deletingId === e.id}
                      data-testid={`button-delete-${e.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Delete {e.name}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
