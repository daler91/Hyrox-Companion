import type { NutritionMacroTotals } from "@shared/schema";

import { Card, CardContent } from "@/components/ui/card";

const MACROS: ReadonlyArray<{ key: keyof NutritionMacroTotals; label: string }> = [
  { key: "calories", label: "Calories" },
  { key: "protein", label: "Protein (g)" },
  { key: "carb", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" },
  { key: "fiber", label: "Fiber (g)" },
];

/** Running daily totals for calories + macros (FR-1.3). */
export function DailyTotalsHeader({ totals }: { readonly totals: NutritionMacroTotals }) {
  return (
    <Card data-testid="nutrition-daily-totals">
      <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
        {MACROS.map((m) => (
          <div
            key={m.key}
            className="flex flex-col items-center justify-center rounded-md bg-muted/40 p-3"
          >
            <span className="text-2xl font-semibold tabular-nums" data-testid={`total-${m.key}`}>
              {totals[m.key]}
            </span>
            <span className="text-xs text-muted-foreground">{m.label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
