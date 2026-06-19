import type { FuellingDayPoint } from "@shared/schema";
import { Check, Flame } from "lucide-react";
import { useLocation } from "wouter";

import { cn } from "@/lib/utils";
import { computeTargetProgress } from "@/pages/nutrition/utils";

/**
 * Compact per-day fuelling chip for the Timeline date header (Phase 2 of the
 * nutrition↔training integration). Shows calories (and protein) progress against
 * the day's load-adjusted target, plus a tick when a post-workout meal was
 * logged. Renders nothing on days with no target and no intake, so it never
 * clutters days the athlete didn't fuel or track. Tapping opens that day in
 * Nutrition. The caller only passes data when the nutrition feature is enabled.
 */
export function FuellingDayChip({
  date,
  fuelling,
}: {
  readonly date: string;
  readonly fuelling: FuellingDayPoint;
}) {
  const [, setLocation] = useLocation();
  const { totals, effectiveTarget, hasPostWorkoutFuel } = fuelling;

  const progress = computeTargetProgress(totals, effectiveTarget);
  const calories = progress.find((p) => p.key === "calories");
  const protein = progress.find((p) => p.key === "protein");
  const hasIntake = totals.calories > 0;

  // Nothing useful to show: no target set and nothing logged for the day.
  if (!calories && !protein && !hasIntake) return null;

  const caloriesOver = calories ? calories.pct > 100 : false;
  const proteinLabel = protein ? `, ${protein.value} of ${protein.target} g protein` : "";
  const postWorkoutLabel = hasPostWorkoutFuel ? ", post-workout meal logged" : "";
  const label = calories
    ? `Fuelling: ${calories.value} of ${calories.target} kcal${proteinLabel}${postWorkoutLabel}`
    : `Fuelling: ${totals.calories} kcal logged${postWorkoutLabel}`;

  return (
    <button
      type="button"
      onClick={() => setLocation(`/nutrition?date=${date}`)}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      aria-label={label}
      title={label}
      data-testid={`fuelling-chip-${date}`}
    >
      <Flame className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="tabular-nums">
        <span className={cn("font-medium", caloriesOver ? "text-amber-500" : "text-foreground")}>
          {totals.calories}
        </span>
        {calories ? <span>/{calories.target}</span> : null}
      </span>
      {protein ? (
        <span className="tabular-nums">
          P <span className="font-medium text-foreground">{protein.value}</span>/{protein.target}
        </span>
      ) : null}
      {hasPostWorkoutFuel ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : null}
    </button>
  );
}
