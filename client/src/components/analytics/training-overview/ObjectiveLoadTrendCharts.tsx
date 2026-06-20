import type { TrainingLoadOverview } from "@shared/schema";

import { CHART_CARD_CLASS } from "../chartConstants";
import { MiniLineChart } from "../MiniLineChart";
import { MultiLineChart } from "../MultiLineChart";

/** Whole-number training-stress label (UTSS / TRIMP / TSS / EWMA / strain). */
function formatLoad(value: number): string {
  return String(Math.round(value));
}

const MIN_POINTS = 2;

/**
 * Surfaces the objective-load signals that are computed server-side but were not
 * yet charted: power TSS and Banister TRIMP (the objective counterparts to the
 * subjective UTSS), the EWMA Fitness/Fatigue curves, and Foster Strain.
 *
 * Objective load needs HR (TRIMP) and power + FTP (TSS); athletes without that
 * data still get Fitness/Fatigue + Strain plus a hint on how to unlock the
 * objective comparison. Renders nothing until there is enough seeded history —
 * AcwrTrendChart above already messages the brand-new-athlete case.
 */
export function ObjectiveLoadTrendCharts({
  trainingLoad,
}: Readonly<{ trainingLoad: TrainingLoadOverview }>) {
  const { trend } = trainingLoad;

  const hasTrimp = trend.filter((p) => p.trimp != null).length >= MIN_POINTS;
  const hasTss = trend.filter((p) => p.tss != null).length >= MIN_POINTS;
  const fitnessData = trend.filter((p) => p.chronicEwma != null && p.acuteEwma != null);
  const strainData = trend.filter((p) => p.strain != null);

  const showObjective = hasTrimp || hasTss;
  const showFitness = fitnessData.length >= MIN_POINTS;
  const showStrain = strainData.length >= MIN_POINTS;

  if (!showObjective && !showFitness && !showStrain) return null;

  const objectiveSeries = [
    { valueKey: "utss", color: "primary", label: "UTSS (subjective)" },
    ...(hasTrimp ? [{ valueKey: "trimp", color: "purple", label: "TRIMP (HR)" }] : []),
    ...(hasTss ? [{ valueKey: "tss", color: "blue", label: "Power TSS" }] : []),
  ];

  return (
    <div className="space-y-6" data-testid="objective-load-trend-charts">
      {showObjective ? (
        <MultiLineChart
          data={trend}
          xKey="date"
          series={objectiveSeries}
          label="Objective vs Subjective Load"
          valueFormatter={formatLoad}
          testId="multi-line-chart-objective-load"
        />
      ) : (
        <div
          className={`${CHART_CARD_CLASS} text-sm text-muted-foreground`}
          data-testid="objective-load-hint"
        >
          <p className="font-semibold text-card-foreground">Objective load needs HR or power</p>
          <p>
            Add your resting/max HR and FTP in Settings → Health Metrics, and log workouts with
            heart-rate or power, to see objective load (TRIMP and Power TSS) next to your
            subjective UTSS.
          </p>
        </div>
      )}
      {showFitness && (
        <MultiLineChart
          data={fitnessData}
          xKey="date"
          series={[
            { valueKey: "chronicEwma", color: "green", label: "Fitness (chronic)" },
            { valueKey: "acuteEwma", color: "amber", label: "Fatigue (acute)" },
          ]}
          label="Fitness & Fatigue"
          valueFormatter={formatLoad}
          testId="multi-line-chart-fitness-fatigue"
        />
      )}
      {showStrain && (
        <MiniLineChart
          data={strainData}
          xKey="date"
          valueKey="strain"
          color="red"
          label="Strain (Foster)"
          valueFormatter={formatLoad}
        />
      )}
    </div>
  );
}
