import { memo } from "react";

import { MultiLineChart } from "./MultiLineChart";

// Thin single-series wrapper over MultiLineChart so both charts share one
// Recharts scaffold (axes, grid, tooltip, reference line). Keeps the
// long-standing MiniLineChart API (valueKey/color) and its
// `line-chart-<valueKey>` testid; a single series renders without a legend.
export const MiniLineChart = memo(function MiniLineChart({
  data,
  xKey = "date",
  valueKey,
  color,
  label,
  referenceLine,
  referenceLineColor,
  valueFormatter,
}: Readonly<{
  data: readonly object[];
  xKey?: string;
  valueKey: string;
  color: string;
  label: string;
  referenceLine?: { value: number; label: string };
  /** Stroke/label colour for the reference line (Tailwind-ish, via getStrokeColor). Defaults to green. */
  referenceLineColor?: string;
  /** Format the y-value for the axis ticks and tooltip (e.g. pace seconds → "m:ss"). */
  valueFormatter?: (value: number) => string;
}>) {
  return (
    <MultiLineChart
      data={data}
      xKey={xKey}
      series={[{ valueKey, color, label }]}
      label={label}
      referenceLine={referenceLine}
      referenceLineColor={referenceLineColor}
      valueFormatter={valueFormatter}
      testId={`line-chart-${valueKey}`}
    />
  );
});
