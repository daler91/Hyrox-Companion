import type { TrainingLoadOverview } from "@shared/schema";
import { useMemo } from "react";

import { MiniLineChart } from "../MiniLineChart";
import { ChartExplanation } from "./ChartExplanation";

/** Signed integer for TSB ("+12" / "-8"). */
function formatTsb(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatMonotony(value: number): string {
  return value.toFixed(2);
}

// Static reference-line objects (no prop/state dependency) — hoisted so they
// keep one reference across renders instead of a fresh literal every time,
// which would defeat MiniLineChart's React.memo below.
const TSB_REFERENCE_LINE = { value: 0, label: "Fresh / fatigued" };
const MONOTONY_REFERENCE_LINE = { value: 2, label: "Overtraining risk" };

/**
 * Trend charts for the two load-dynamics metrics that complement ACWR: Form
 * (TSB) over time and Foster Monotony over time. Each renders only once it has
 * more than one seeded point (mirrors OverviewTrendCharts); the AcwrTrendChart
 * above already messages the no-history case for the load section, so when
 * neither metric is seeded yet this renders nothing.
 */
export function FormMonotonyTrendCharts({
  trainingLoad,
  explanation,
}: Readonly<{ trainingLoad: TrainingLoadOverview; explanation?: string }>) {
  // Memoized so `tsbData`/`monotonyData` stay referentially stable across
  // unrelated re-renders (e.g. AI overview-analysis query polling) — mirrors
  // ObjectiveLoadTrendCharts, whose MultiLineChart/MiniLineChart React.memo
  // relies on stable props to skip the Recharts re-render.
  const { trend } = trainingLoad;
  const { tsbData, monotonyData } = useMemo(() => {
    const tsb: typeof trend = [];
    const monotony: typeof trend = [];
    for (const point of trend) {
      if (point.tsb != null) tsb.push(point);
      if (point.monotony != null) monotony.push(point);
    }
    return { tsbData: tsb, monotonyData: monotony };
  }, [trend]);

  if (tsbData.length <= 1 && monotonyData.length <= 1) return null;

  return (
    <div className="space-y-6" data-testid="load-dynamics-trend-charts">
      {tsbData.length > 1 && (
        <MiniLineChart
          data={tsbData}
          xKey="date"
          valueKey="tsb"
          color="purple"
          label="Form (TSB)"
          referenceLine={TSB_REFERENCE_LINE}
          valueFormatter={formatTsb}
        />
      )}
      {monotonyData.length > 1 && (
        <MiniLineChart
          data={monotonyData}
          xKey="date"
          valueKey="monotony"
          color="amber"
          label="Monotony"
          referenceLine={MONOTONY_REFERENCE_LINE}
          referenceLineColor="red"
          valueFormatter={formatMonotony}
        />
      )}
      <ChartExplanation explanation={explanation} />
    </div>
  );
}
