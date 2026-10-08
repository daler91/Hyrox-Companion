import { memo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_CARD_CLASS,
  COLOR_GREEN,
  formatChartDate,
  formatChartDateWithYear,
  getStrokeColor,
  GRID_BORDER,
  GRID_DASH,
  MUTED_FG,
} from "./chartConstants";

interface ChartSeries {
  /** Field on each datum to plot. */
  valueKey: string;
  /** Tailwind-ish colour string, resolved via getStrokeColor. */
  color: string;
  /** Legend + tooltip label. */
  label: string;
}

function tooltipDateLabel(dateStr: string, xKey: string): string {
  const formatted = formatChartDateWithYear(dateStr);
  return xKey === "weekStart" ? `Week of ${formatted}` : formatted;
}

export function MultiLineTooltip({
  active,
  payload,
  formatValue,
  xKey = "date",
}: Readonly<{
  active?: boolean;
  payload?: Array<{ value: number | null; name?: string; color?: string; payload?: Record<string, unknown> }>;
  formatValue?: (value: number) => string;
  xKey?: string;
}>) {
  if (!active || !payload?.length) return null;

  // U7 (CODEBASE_ANALYSIS_2026-10-03): read the chart's own x key (the weekly
  // charts are keyed on `weekStart`, not `date`) and keep the year, since
  // all-time charts can span years while the axis ticks omit it.
  const datum = payload[0]?.payload;
  const rawDate = datum ? new Map(Object.entries(datum)).get(xKey) : undefined;
  const dateStr = typeof rawDate === "string" ? rawDate : "";

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      {dateStr && <p className="font-semibold mb-1">{tooltipDateLabel(dateStr, xKey)}</p>}
      {payload.map((entry) => {
        let displayValue: string | number = "N/A";
        if (entry.value != null) {
          displayValue = formatValue ? formatValue(entry.value) : Math.round(entry.value * 10) / 10;
        }
        return (
          <p key={entry.name}>
            <span className="mr-2" style={{ color: entry.color }}>{entry.name}:</span>
            <span className="font-medium">{displayValue}</span>
          </p>
        );
      })}
    </div>
  );
}

// ⚡ React.memo prevents expensive Recharts re-renders when the parent re-renders
// but the chart props (data, series, label) are unchanged.
export const MultiLineChart = memo(function MultiLineChart({
  data,
  xKey = "date",
  series,
  label,
  referenceLine,
  referenceLineColor,
  valueFormatter,
  testId,
}: Readonly<{
  data: readonly object[];
  xKey?: string;
  series: ReadonlyArray<ChartSeries>;
  label: string;
  referenceLine?: { value: number; label: string };
  /** Stroke/label colour for the reference line (Tailwind-ish, via getStrokeColor). Defaults to green. */
  referenceLineColor?: string;
  /** Format the y-value for the axis ticks and tooltip. */
  valueFormatter?: (value: number) => string;
  /** Stable data-testid + screen-reader handle (e.g. "multi-line-chart-fitness-fatigue"). */
  testId: string;
}>) {
  if (data.length === 0 || series.length === 0) return null;

  const refLineColor = referenceLineColor ? getStrokeColor(referenceLineColor) : COLOR_GREEN;

  return (
    <div className={CHART_CARD_CLASS}>
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="h-[160px] w-full sm:h-[200px]" data-testid={testId} role="img" aria-label={`${label}, line chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 5, left: valueFormatter ? 0 : -20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray={GRID_DASH} vertical={false} stroke={GRID_BORDER} />
            <XAxis
              dataKey={xKey}
              tickFormatter={(v: string) => formatChartDate(v)}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: MUTED_FG }}
            />
            <YAxis
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: MUTED_FG }}
              tickFormatter={valueFormatter ? (v: number) => valueFormatter(Number(v)) : undefined}
            />
            <Tooltip
              cursor={{ stroke: MUTED_FG, strokeDasharray: GRID_DASH }}
              content={<MultiLineTooltip formatValue={valueFormatter} xKey={xKey} />}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {referenceLine && (
              <ReferenceLine
                y={referenceLine.value}
                stroke={refLineColor}
                strokeDasharray="6 3"
                label={{
                  value: referenceLine.label,
                  position: "right",
                  fill: refLineColor,
                  fontSize: 11,
                }}
              />
            )}
            {series.map((s) => {
              const stroke = getStrokeColor(s.color);
              return (
                <Line
                  key={s.valueKey}
                  type="monotone"
                  dataKey={s.valueKey}
                  name={s.label}
                  stroke={stroke}
                  strokeWidth={2}
                  dot={{ r: 3, fill: stroke }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
