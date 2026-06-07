import type { Food } from "@shared/schema";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { useSearchFoods } from "@/hooks/useNutrition";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/** Food search box → results list (FR-1.1). Selecting a result opens the log dialog. */
export function FoodSearch({ onSelect }: { readonly onSelect: (food: Food) => void }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isFetching } = useSearchFoods(debounced);
  const results = data?.results ?? [];
  const showResults = debounced.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search foods (e.g. banana, chicken breast)"
          className="pl-9"
          aria-label="Search foods"
          data-testid="input-food-search"
        />
      </div>

      {data?.apiDegraded && (
        <p className="text-xs text-muted-foreground" data-testid="text-search-degraded">
          Showing cached results — live food search is temporarily unavailable.
        </p>
      )}

      {showResults && (
        <div className="overflow-hidden rounded-md border">
          {isFetching && results.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          )}
          {!isFetching && results.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground" data-testid="text-search-empty">
              No foods found.
            </p>
          )}
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => onSelect(food)}
              className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid={`result-food-${food.id}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{food.name}</span>
                {food.brand && (
                  <span className="block truncate text-xs text-muted-foreground">{food.brand}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {food.caloriesPer100g == null
                  ? "—"
                  : `${Math.round(food.caloriesPer100g)} kcal/100g`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
