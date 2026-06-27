import type { TrainingLoadOverview } from "@shared/schema";

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
  const tsbData = trainingLoad.trend.filter((point) => point.tsb != null);
  const monotonyData = trainingLoad.trend.filter((point) => point.monotony != null);

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
          referenceLine={{ value: 0, label: "Fresh / fatigued" }}
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
          referenceLine={{ value: 2, label: "Overtraining risk" }}
          referenceLineColor="red"
          valueFormatter={formatMonotony}
        />
      )}
      <ChartExplanation explanation={explanation} />
    </div>
  );
}
