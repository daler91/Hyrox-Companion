import type { Food, FoodWithPortionMemory } from "@shared/schema";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useDeleteLog, useFavorites, useLogFood, useRecentFoods } from "@/hooks/useNutrition";

import { loggedAtForDate, MEAL_LABELS } from "./utils";

const MAX_LABEL = 24;

function FoodChipRow<T extends Food>({
  title,
  foods,
  onSelect,
  testid,
}: {
  readonly title: string;
  readonly foods: readonly T[];
  readonly onSelect: (food: T) => void;
  readonly testid: string;
}) {
  return (
    <div>
      <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid={`quickadd-${testid}`}>
        {foods.map((food) => (
          <button
            key={food.id}
            type="button"
            onClick={() => onSelect(food)}
            className="shrink-0 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={food.name.length > MAX_LABEL ? `Quick add ${food.name}` : undefined}
            data-testid={`quickadd-${testid}-${food.id}`}
          >
            {food.name.length > MAX_LABEL ? `${food.name.slice(0, MAX_LABEL)}…` : food.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Recent foods (FR-1.4) + favourites (FR-1.5) as one-tap quick-add chips.
 *
 * Favourites log straight away using the portion they were last logged in —
 * these are the athlete's own curated regulars, so the amount is a known
 * quantity and a confirm step is friction with no decision in it. An undo toast
 * covers the mis-tap. Recent chips still open the dialog: that list is
 * automatic, much longer, and a stray tap there is a real logging error.
 *
 * A favourite with no logging history yet has no portion to reuse, so it falls
 * back to the dialog too.
 */
export function QuickAddBar({
  onSelect,
  date,
}: {
  readonly onSelect: (food: Food) => void;
  readonly date: string;
}) {
  const { data: recent = [] } = useRecentFoods();
  const { data: favorites = [] } = useFavorites();
  const logFood = useLogFood(date);
  const deleteLog = useDeleteLog(date);
  const { toast } = useToast();

  if (recent.length === 0 && favorites.length === 0) return null;

  const quickLog = (food: FoodWithPortionMemory) => {
    if (food.lastQuantityG == null || food.lastMealType == null) {
      onSelect(food);
      return;
    }

    logFood.mutate(
      {
        foodId: food.id,
        quantityG: food.lastQuantityG,
        mealType: food.lastMealType,
        loggedAt: loggedAtForDate(date),
      },
      {
        onSuccess: (result) => {
          // A queued offline write has no id to undo yet; its own toast already
          // explains that it will sync.
          if (result.status !== "saved") return;
          const entryId = result.data.id;
          toast({
            title: "Food logged",
            description: `${food.name} · ${Math.round(food.lastQuantityG ?? 0)} g · ${MEAL_LABELS[food.lastMealType ?? "snack"]}`,
            action: (
              <ToastAction
                altText={`Undo logging ${food.name}`}
                onClick={() => deleteLog.mutate(entryId)}
                data-testid="button-undo-quickadd"
              >
                Undo
              </ToastAction>
            ),
          });
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {favorites.length > 0 && (
        <FoodChipRow title="Favorites" foods={favorites} onSelect={quickLog} testid="favorites" />
      )}
      {recent.length > 0 && (
        <FoodChipRow title="Recent" foods={recent} onSelect={onSelect} testid="recent" />
      )}
    </div>
  );
}
