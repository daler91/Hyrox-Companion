import type { EffectiveTargetSummary, NutritionMacroTotals } from "@shared/schema";
import { Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { MacroProgressBar } from "./MacroProgressBar";
import { computeTargetProgress, type TargetProgressRow } from "./utils";

const MACROS: ReadonlyArray<{ key: keyof NutritionMacroTotals; label: string }> = [
  { key: "calories", label: "Calories" },
  { key: "protein", label: "Protein (g)" },
  { key: "carb", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" },
  { key: "fiber", label: "Fiber (g)" },
];

/** The dominant driver of the carb adjustment, for a concise caption. The full
 *  per-component breakdown is in `effectiveTarget.explanation` (shown on hover). */
function dominantCarbReason(t: EffectiveTargetSummary): string {
  const max = Math.max(Math.abs(t.baseLoadDeltaG), t.recoveryDeltaG, t.preloadDeltaG);
  if (t.preloadDeltaG > 0 && max === t.preloadDeltaG) {
    return t.phase === "race_week" ? "race week" : "to fuel ahead";
  }
  if (t.recoveryDeltaG > 0 && max === t.recoveryDeltaG) return "for recovery";
  return t.baseLoadDeltaG >= 0 ? "for today's load" : "lighter day";
}

/** The carb adjustment note when the day's target is load-scaled (FR-5.x). */
function carbLoadNote(effectiveTarget: EffectiveTargetSummary | null): string | null {
  if (!effectiveTarget?.scaled || effectiveTarget.carbDeltaG === 0) return null;
  const { carbDeltaG } = effectiveTarget;
  const sign = carbDeltaG > 0 ? `+${carbDeltaG}` : `${carbDeltaG}`;
  return `${sign}g ${dominantCarbReason(effectiveTarget)}`;
}

/** The protein bump note on recovery days (training-aware periodisation). */
function proteinRecoveryNote(effectiveTarget: EffectiveTargetSummary | null): string | null {
  if (!effectiveTarget?.scaled || effectiveTarget.proteinDeltaG <= 0) return null;
  return `+${effectiveTarget.proteinDeltaG}g recovery`;
}

/** Running daily totals for calories + macros (FR-1.3), with progress toward the
 *  day's effective target where one is set — including carb periodisation by
 *  training load (FR-5.2 / FR-5.x). */
export function DailyTotalsHeader({
  totals,
  effectiveTarget = null,
  onSetTargets,
}: {
  readonly totals: NutritionMacroTotals;
  readonly effectiveTarget?: EffectiveTargetSummary | null;
  /** Opens the targets editor; shown as a CTA while no target exists so the
   *  bare zeros come with a way to make them mean something. */
  readonly onSetTargets?: () => void;
}) {
  const progressByKey = new Map<string, TargetProgressRow>(
    computeTargetProgress(totals, effectiveTarget).map((r) => [r.key, r]),
  );
  const carbNote = carbLoadNote(effectiveTarget);
  const proteinNote = proteinRecoveryNote(effectiveTarget);

  const showSetTargetsCta = effectiveTarget === null && onSetTargets !== undefined;

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
                  <MacroProgressBar
                    pct={progress.pct}
                    label={m.label}
                    value={progress.value}
                    target={progress.target}
                  />
                  <span className="mt-0.5 block text-center text-[10px] tabular-nums text-muted-foreground">
                    {progress.value} / {progress.target}
                  </span>
                </div>
              )}
              {m.key === "carb" && carbNote && (
                <span
                  className="mt-0.5 block text-center text-[10px] font-medium text-primary"
                  data-testid="carb-load-note"
                  title={effectiveTarget?.explanation || undefined}
                >
                  {carbNote}
                </span>
              )}
              {m.key === "protein" && proteinNote && (
                <span
                  className="mt-0.5 block text-center text-[10px] font-medium text-primary"
                  data-testid="protein-recovery-note"
                  title={effectiveTarget?.explanation || undefined}
                >
                  {proteinNote}
                </span>
              )}
            </div>
          );
        })}
      </CardContent>
      {showSetTargetsCta && (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            Set daily targets to see progress toward your fuelling goals.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onSetTargets}
            data-testid="button-set-targets-cta"
          >
            <Target className="mr-2 h-4 w-4" aria-hidden="true" /> Set targets
          </Button>
        </div>
      )}
    </Card>
  );
}
