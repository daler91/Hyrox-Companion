import type { HrZone, TrainingLoadOverview } from "@shared/schema";

import { CHART_CARD_CLASS } from "../chartConstants";
import { MiniLineChart } from "../MiniLineChart";
import { MultiLineChart } from "../MultiLineChart";
import { ChartExplanation } from "./ChartExplanation";

/** Whole-number training-stress label (UTSS / hrTSS / TSS / EWMA / strain). */
function formatLoad(value: number): string {
  return String(Math.round(value));
}

const MIN_POINTS = 2;

const HR_ZONE_LABELS: Record<HrZone, string> = {
  z1: "Recovery",
  z2: "Aerobic",
  z3: "Tempo",
  z4: "Threshold",
  z5: "VO2max",
};

/**
 * Surfaces the objective-load signals that are computed server-side but were not
 * yet charted: power TSS and hrTSS (the objective counterparts to the subjective
 * UTSS), the Karvonen HR-zone legend, the EWMA Fitness/Fatigue curves, and Foster
 * Strain.
 *
 * Objective load needs HR (hrTSS) and power + FTP (TSS); athletes without that
 * data still get Fitness/Fatigue + Strain plus a hint on how to unlock the
 * objective comparison. Renders nothing until there is enough seeded history —
 * AcwrTrendChart above already messages the brand-new-athlete case.
 */
export function ObjectiveLoadTrendCharts({
  trainingLoad,
  explanation,
}: Readonly<{ trainingLoad: TrainingLoadOverview; explanation?: string }>) {
  const { trend } = trainingLoad;

  const hasHrTss = trend.filter((p) => p.hrTss != null).length >= MIN_POINTS;
  const hasTss = trend.filter((p) => p.tss != null).length >= MIN_POINTS;
  const fitnessData = trend.filter((p) => p.chronicEwma != null && p.acuteEwma != null);
  const strainData = trend.filter((p) => p.strain != null);

  const showObjective = hasHrTss || hasTss;
  const showFitness = fitnessData.length >= MIN_POINTS;
  const showStrain = strainData.length >= MIN_POINTS;
  const showZones = hasHrTss && trainingLoad.hrZones.length > 0;

  if (!showObjective && !showFitness && !showStrain) return null;

  const objectiveSeries = [
    { valueKey: "utss", color: "primary", label: "UTSS (subjective)" },
    ...(hasHrTss ? [{ valueKey: "hrTss", color: "purple", label: "hrTSS (HR)" }] : []),
    ...(hasTss ? [{ valueKey: "tss", color: "blue", label: "Power TSS (est.)" }] : []),
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
            heart-rate or power, to see objective load (hrTSS and Power TSS) next to your
            subjective UTSS.
          </p>
        </div>
      )}
      {showZones && (
        <div className={`${CHART_CARD_CLASS} text-sm`} data-testid="hr-zone-legend">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-card-foreground">Heart-rate zones (Karvonen %HRR)</p>
            <p className="text-xs text-muted-foreground">
              Est. LTHR ~{trainingLoad.estimatedLthr} bpm
            </p>
          </div>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-5 sm:gap-2">
            {trainingLoad.hrZones.map((zone) => {
              const isCurrent = zone.zone === trainingLoad.hrZone;
              return (
                <li
                  key={zone.zone}
                  data-testid={`hr-zone-${zone.zone}`}
                  data-current={isCurrent ? "true" : undefined}
                  className={`rounded-md px-2 py-1 ${
                    isCurrent
                      ? "bg-primary/10 font-semibold text-card-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <span className="uppercase">{zone.zone}</span>{" "}
                  <span className="tabular-nums">
                    {zone.minHr}–{zone.maxHr}
                  </span>
                  <span className="block text-xs">{HR_ZONE_LABELS[zone.zone]}</span>
                </li>
              );
            })}
          </ul>
          {trainingLoad.hrZone && (
            <p className="mt-2 text-xs text-muted-foreground">
              Most intense session today:{" "}
              <span className="font-medium uppercase text-card-foreground">
                {trainingLoad.hrZone}
              </span>
            </p>
          )}
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
      <ChartExplanation explanation={explanation} />
    </div>
  );
}
