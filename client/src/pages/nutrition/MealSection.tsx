import type { FoodLogEntryWithNutrition, MealFuelTarget, MealRole, MealType, NutritionMacroTotals } from "@shared/schema";
import { Pencil, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { MacroProgressBar } from "./MacroProgressBar";
import { computeTargetProgress } from "./utils";

interface MealSectionProps {
  readonly label: string;
  readonly mealType: MealType;
  readonly entries: readonly FoodLogEntryWithNutrition[];
  /** The day's fuel target for this meal (per-meal fuelling), or null. */
  readonly target?: MealFuelTarget | null;
  readonly onEdit: (entry: FoodLogEntryWithNutrition) => void;
  readonly onDelete: (id: string) => void;
  readonly deletingId?: string;
  /** Open the per-meal target override editor (only shown when a target exists). */
  readonly onEditTarget?: (mealType: MealType) => void;
}

const ROLE_CAPTION: Record<MealRole, string> = {
  pre_workout_fast_carbs: "Pre-workout fuel",
  post_workout_recovery: "Post-workout refuel",
  standard: "",
  flex_remainder: "Flexible",
};

const EMPTY_TOTALS: NutritionMacroTotals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };

function sumNutrition(entries: readonly FoodLogEntryWithNutrition[]): NutritionMacroTotals {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.nutrition.calories,
      protein: acc.protein + e.nutrition.protein,
      carb: acc.carb + e.nutrition.carb,
      fat: acc.fat + e.nutrition.fat,
      fiber: acc.fiber + e.nutrition.fiber,
    }),
    EMPTY_TOTALS,
  );
}

/** One meal's fuel target + logged entries (per-meal fuelling). Shows the target
 *  even before anything is logged; hidden only when there's neither a target nor
 *  an entry. */
export function MealSection({ label, mealType, entries, target, onEdit, onDelete, deletingId, onEditTarget }: MealSectionProps) {
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  if (entries.length === 0 && !target) return null;

  const logged = sumNutrition(entries);
  // Per-macro progress toward the meal target (carb/protein/fat bars; calories
  // sit in the header). Reuses the daily header's progress maths so the two agree.
  const macroRows = target
    ? computeTargetProgress(logged, {
        calories: target.calories,
        proteinG: target.proteinG,
        carbG: target.carbG,
        fatG: target.fatG,
      }).filter((r) => r.key !== "calories")
    : [];
  const isCustomTarget = !!target?.reasonCodes.includes("user_override");
  let caption = "";
  if (target) caption = isCustomTarget ? "Custom" : ROLE_CAPTION[target.role];

  return (
    <section data-testid={`meal-section-${label.toLowerCase()}`}>
      <header className="px-1">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">{label}</h2>
            {caption && <span className="text-[11px] font-medium text-primary">{caption}</span>}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              {target
                ? `${Math.round(logged.calories)} / ${Math.round(target.calories)} kcal`
                : `${Math.round(logged.calories)} kcal`}
            </span>
            {target && onEditTarget && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                aria-label={`Adjust ${label} target`}
                onClick={() => onEditTarget(mealType)}
                data-testid={`button-edit-meal-target-${mealType}`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {target && (
          <div className="mt-1.5 space-y-1" data-testid={`meal-target-${mealType}`}>
            {macroRows.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {macroRows.map((r) => (
                  <div key={r.key}>
                    <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                      <span>{r.label}</span>
                      <span>
                        {Math.round(r.value)}/{Math.round(r.target)}g
                      </span>
                    </div>
                    <MacroProgressBar pct={r.pct} />
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{target.rationale}</p>
          </div>
        )}
      </header>

      {entries.length > 0 ? (
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
                        onClick={() => setPendingDelete({ id: e.id, name: e.name })}
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
      ) : (
        <p
          className="mt-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
          data-testid={`meal-empty-${mealType}`}
        >
          Nothing logged yet.
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete food entry?"
        description={`"${pendingDelete?.name}" will be removed from this meal.`}
        confirmText="Delete"
        isDestructive
        isPending={deletingId === pendingDelete?.id}
        onConfirm={() => {
          if (!pendingDelete) return;
          onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        confirmTestId="confirm-delete-food-log"
        cancelTestId="cancel-delete-food-log"
      />
    </section>
  );
}
