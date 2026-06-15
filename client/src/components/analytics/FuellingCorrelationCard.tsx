import {
  analyzeFuellingCorrelation,
  type FuellingMetricComparison,
} from "@shared/fuellingCorrelation";
import type { BlockViewPoint } from "@shared/schema";
import { Gauge } from "lucide-react";
import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";

/** "−0.9 lower (felt easier)" / "no clear difference" style qualifier for RPE. */
function rpeDeltaText(c: FuellingMetricComparison): string {
  if (Math.abs(c.delta) < 0.3) return "no clear difference";
  const magnitude = Math.round(Math.abs(c.delta) * 10) / 10;
  return c.delta < 0 ? `${magnitude} lower (felt easier)` : `${magnitude} higher (felt harder)`;
}

function complianceDeltaText(c: FuellingMetricComparison): string {
  if (Math.abs(c.delta) < 3) return "about the same";
  return c.delta > 0 ? `${c.delta} pts better` : `${Math.abs(c.delta)} pts worse`;
}

function MetricRow({
  label,
  comparison,
  format,
  deltaText,
  testId,
}: {
  readonly label: string;
  readonly comparison: FuellingMetricComparison;
  readonly format: (n: number) => string;
  readonly deltaText: string;
  readonly testId: string;
}) {
  return (
    <div
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      data-testid={testId}
    >
      <span className="text-sm">{label}</span>
      <span className="text-sm tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">{format(comparison.hitAvg)}</span> on
        carb-hit days ({comparison.hitDays}) vs{" "}
        <span className="font-semibold text-foreground">{format(comparison.missAvg)}</span> missed (
        {comparison.missDays}) — {deltaText}
      </span>
    </div>
  );
}

/**
 * Roadmap G — fuelling↔performance correlation on the Analytics Fuelling tab:
 * compares session RPE and prescription compliance between days the athlete hit
 * ≥90% of their (load-adjusted) carb target and days they missed it. Computed
 * client-side with the pure shared calculator from the block-view points the
 * tab already loads. Renders nothing when no day in range has both a carb
 * target and a training outcome; shows a keep-logging note under the min-N
 * guard. Framed as an association, not causation.
 */
export function FuellingCorrelationCard({
  points,
}: {
  readonly points: readonly BlockViewPoint[];
}) {
  const result = useMemo(
    () =>
      analyzeFuellingCorrelation(
        points.map((p) => ({
          carbG: p.carb,
          carbTargetG: p.carbTargetG ?? null,
          avgRpe: p.avgRpe ?? null,
          compliancePct: p.compliancePct ?? null,
        })),
      ),
    [points],
  );

  if (result.eligibleDays === 0) return null;

  return (
    <Card data-testid="fuelling-correlation-card" title={result.explanation}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Fuelling and performance</h3>
        </div>

        {result.status === "ok" ? (
          <div className="space-y-2">
            {result.rpe && (
              <MetricRow
                label="Session RPE"
                comparison={result.rpe}
                format={String}
                deltaText={rpeDeltaText(result.rpe)}
                testId="fuelling-correlation-rpe"
              />
            )}
            {result.compliance && (
              <MetricRow
                label="Workout compliance"
                comparison={result.compliance}
                format={(n) => `${n}%`}
                deltaText={complianceDeltaText(result.compliance)}
                testId="fuelling-correlation-compliance"
              />
            )}
            <p className="text-[11px] text-muted-foreground/70">
              {result.eligibleDays} training days compared (carb target hit = ≥{result.carbHitPct}%
              of that day's target). Association, not causation.
            </p>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="fuelling-correlation-insufficient"
          >
            Not enough overlap yet between carb-target days and recorded RPE or compliance — keep
            logging food and workouts to unlock this comparison.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
