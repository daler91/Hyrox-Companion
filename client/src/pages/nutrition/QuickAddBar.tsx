import type { Food } from "@shared/schema";

import { useFavorites, useRecentFoods } from "@/hooks/useNutrition";

const MAX_LABEL = 24;

function FoodChipRow({
  title,
  foods,
  onSelect,
  testid,
}: {
  readonly title: string;
  readonly foods: readonly Food[];
  readonly onSelect: (food: Food) => void;
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
            className="shrink-0 rounded-full border px-3 py-1 text-sm hover:bg-accent"
            data-testid={`quickadd-${testid}-${food.id}`}
          >
            {food.name.length > MAX_LABEL ? `${food.name.slice(0, MAX_LABEL)}…` : food.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Recent foods (FR-1.4) + favorites (FR-1.5) as one-tap quick-add chips. */
export function QuickAddBar({ onSelect }: { readonly onSelect: (food: Food) => void }) {
  const { data: recent = [] } = useRecentFoods();
  const { data: favorites = [] } = useFavorites();

  if (recent.length === 0 && favorites.length === 0) return null;

  return (
    <div className="space-y-3">
      {favorites.length > 0 && (
        <FoodChipRow title="Favorites" foods={favorites} onSelect={onSelect} testid="favorites" />
      )}
      {recent.length > 0 && (
        <FoodChipRow title="Recent" foods={recent} onSelect={onSelect} testid="recent" />
      )}
    </div>
  );
}
