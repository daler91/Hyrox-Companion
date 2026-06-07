import type { EffectiveTargetSummary, NutritionMacroTotals } from "@shared/schema";

import { Card, CardContent } from "@/components/ui/card";

import { computeTargetProgress, type TargetProgressRow } from "./utils";

const MACROS: ReadonlyArray<{ key: keyof NutritionMacroTotals; label: string }> = [
  { key: "calories", label: "Calories" },
  { key: "protein", label: "Protein (g)" },
  { key: "carb", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" },
  { key: "fiber", label: "Fiber (g)" },
];

/** The carb adjustment note when the day's target is load-scaled (FR-5.x). */
function carbLoadNote(effectiveTarget: EffectiveTargetSummary | null): string | null {
  if (!effectiveTarget?.scaled || effectiveTarget.carbDeltaG === 0) return null;
  return effectiveTarget.carbDeltaG > 0
    ? `+${effectiveTarget.carbDeltaG}g for today's load`
    : `${effectiveTarget.carbDeltaG}g (lighter day)`;
}

/** Running daily totals for calories + macros (FR-1.3), with progress toward the
 *  day's effective target where one is set — including carb periodisation by
 *  training load (FR-5.2 / FR-5.x). */
export function DailyTotalsHeader({
  totals,
  effectiveTarget = null,
}: {
  readonly totals: NutritionMacroTotals;
  readonly effectiveTarget?: EffectiveTargetSummary | null;
}) {
  const progressByKey = new Map<string, TargetProgressRow>(
    computeTargetProgress(totals, effectiveTarget).map((r) => [r.key, r]),
  );
  const carbNote = carbLoadNote(effectiveTarget);

  return (
    <Card data-testid="nutrition-daily-totals">
      <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
        {MACROS.map((m) => {
          const progress = progressByKey.get(m.key);
          return (
            <div
              key={m.key}
              className="flex flex-col items-center justify-center rounded-md bg-muted/40 p-3"
            >
              <span className="text-2xl font-semibold tabular-nums" data-testid={`total-${m.key}`}>
                {totals[m.key]}
              </span>
              <span className="text-xs text-muted-foreground">{m.label}</span>
              {progress && (
                <div className="mt-1.5 w-full" data-testid={`target-progress-${m.key}`}>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${progress.pct > 100 ? "bg-amber-500" : "bg-primary"}`}
                      style={{ width: `${Math.min(progress.pct, 100)}%` }}
                    />
                  </div>
                  <span className="mt-0.5 block text-center text-[10px] tabular-nums text-muted-foreground">
                    {progress.value} / {progress.target}
                  </span>
                </div>
              )}
              {m.key === "carb" && carbNote && (
                <span
                  className="mt-0.5 block text-center text-[10px] font-medium text-primary"
                  data-testid="carb-load-note"
                >
                  {carbNote}
                </span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
