import type { NutritionMacroTotals } from "@shared/schema";

import { MACRO_COLORS } from "./CalorieBreakdownRing";
import type { MacroEnergyShares } from "./utils";

/** FDA Daily Value for fibre — drives the informational fibre bar only (no goal). */
const FIBER_DV_G = 28;

const MACRO_ROWS = [
  { key: "protein", label: "Protein", color: MACRO_COLORS.protein },
  { key: "carb", label: "Carbs", color: MACRO_COLORS.carb },
  { key: "fat", label: "Fat", color: MACRO_COLORS.fat },
] as const;

/**
 * Labelled macro rows for the serving: grams, % of energy, and a bar (coloured to
 * match the calorie ring). Replaces the old flat 5-number strip. Keeps the
 * `preview-*` test ids so existing tests still target the same numbers.
 */
export function MacroRows({
  totals,
  shares,
}: {
  readonly totals: NutritionMacroTotals;
  readonly shares: MacroEnergyShares;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Calories</span>
        <span className="text-2xl font-semibold tabular-nums" data-testid="preview-calories">
          {totals.calories}
        </span>
      </div>

      <div className="space-y-2.5">
        {MACRO_ROWS.map((m) => {
          const share = shares[m.key];
          return (
            <div key={m.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{m.label}</span>
                <span className="tabular-nums">
                  <span className="font-medium" data-testid={`preview-${m.key}`}>
                    {totals[m.key]}
                  </span>{" "}
                  g<span className="ml-2 text-xs text-muted-foreground">{share.pct}% energy</span>
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(share.pct, 100)}%`, backgroundColor: m.color }}
                />
              </div>
            </div>
          );
        })}

        {/* Fibre — no energy share; the bar is informational vs the 28 g Daily Value. */}
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Fiber</span>
            <span className="tabular-nums">
              <span className="font-medium" data-testid="preview-fiber">
                {totals.fiber}
              </span>{" "}
              g<span className="ml-2 text-xs text-muted-foreground">of {FIBER_DV_G} g</span>
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min((totals.fiber / FIBER_DV_G) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
