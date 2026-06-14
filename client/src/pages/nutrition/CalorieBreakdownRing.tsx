import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { MacroEnergyShares } from "./utils";

/** Macro slice colours (chart tokens) — reused by MacroRows' bars for consistency. */
export const MACRO_COLORS = {
  protein: "hsl(var(--chart-1))",
  carb: "hsl(var(--chart-2))",
  fat: "hsl(var(--chart-3))",
} as const;

const SLICES = [
  { key: "protein", label: "Protein" },
  { key: "carb", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const;

/**
 * Cronometer-style calorie-breakdown donut: the share of energy from protein,
 * carbs, and fat for the current serving, with calories in the centre. The ring
 * normalises by macro-derived energy (so the slices always sum to 100%); the
 * centre shows the food's label calories, which can differ slightly. Follows the
 * repo's chart convention (a `role="img"` wrapper around the ResponsiveContainer)
 * so it stays accessible and testable under jsdom.
 */
export function CalorieBreakdownRing({
  shares,
  calories,
}: {
  readonly shares: MacroEnergyShares;
  readonly calories: number;
}) {
  const hasEnergy = shares.totalKcal > 0;
  const data = SLICES.map((s) => ({
    name: s.label,
    value: shares[s.key].kcal,
    fill: MACRO_COLORS[s.key],
  })).filter((d) => d.value > 0);

  const ariaLabel = `Calorie breakdown: protein ${shares.protein.pct}%, carbs ${shares.carb.pct}%, fat ${shares.fat.pct}%`;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
      <div
        className="relative h-36 w-36 shrink-0"
        role="img"
        aria-label={ariaLabel}
        data-testid="calorie-ring"
      >
        {hasEnergy ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={64}
                paddingAngle={data.length > 1 ? 2 : 0}
                dataKey="value"
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-[18px] rounded-full border-[16px] border-muted" aria-hidden="true" />
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold leading-none tabular-nums">{calories}</span>
          <span className="text-[10px] uppercase text-muted-foreground">kcal</span>
        </div>
      </div>

      <ul className="grid w-full max-w-[12rem] gap-1.5">
        {SLICES.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: MACRO_COLORS[s.key] }}
                aria-hidden="true"
              />
              <span className="truncate text-muted-foreground">{s.label}</span>
            </span>
            <span className="font-medium tabular-nums">{shares[s.key].pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
