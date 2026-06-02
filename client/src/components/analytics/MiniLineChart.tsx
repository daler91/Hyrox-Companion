import { memo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_CARD_CLASS, COLOR_GREEN, COLOR_PRIMARY, formatChartDate,GRID_BORDER, GRID_DASH, MUTED_FG } from "./chartConstants";

const getStrokeColor = (colorStr: string): string => {
  if (colorStr.includes("primary")) return COLOR_PRIMARY;
  if (colorStr.includes("purple")) return "#a855f7";
  if (colorStr.includes("blue")) return "#3b82f6";
  if (colorStr.includes("green")) return COLOR_GREEN;
  if (colorStr.includes("amber")) return "#f59e0b";
  if (colorStr.includes("red")) return "#ef4444";
  return "#64748b";
};

function LineChartTooltip({ active, payload, chartLabel, formatValue }: Readonly<{ active?: boolean; payload?: Array<{ value: number; payload?: Record<string, unknown> }>; chartLabel?: string; formatValue?: (value: number) => string }>) {
  if (!active || !payload?.length) return null;

  const firstPayload = payload[0]?.payload;
  const rawDate = firstPayload?.date ?? firstPayload?.weekStart ?? "";
  const dateStr = typeof rawDate === "string" ? rawDate : "";
  const rawValue = payload[0]?.value;
  const displayValue =
    rawValue == null ? "N/A" : formatValue ? formatValue(rawValue) : Math.round(rawValue * 10) / 10;

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        {dateStr ? formatChartDate(dateStr) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">{chartLabel}:</span>
        <span className="font-medium">{displayValue}</span>
      </p>
    </div>
  );
}

// ⚡ React.memo prevents expensive Recharts re-renders when parent
// re-renders but chart props (data, color, label, etc.) haven't changed.
export const MiniLineChart = memo(function MiniLineChart({
  data,
  xKey = "date",
  valueKey,
  color,
  label,
  referenceLine,
  valueFormatter,
}: Readonly<{
  data: readonly object[];
  xKey?: string;
  valueKey: string;
  color: string;
  label: string;
  referenceLine?: { value: number; label: string };
  /** Format the y-value for the axis ticks and tooltip (e.g. pace seconds → "m:ss"). */
  valueFormatter?: (value: number) => string;
}>) {
  if (data.length === 0) return null;

  const strokeColor = getStrokeColor(color);

  return (
    <div className={CHART_CARD_CLASS}>
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="h-[200px] w-full" data-testid={`line-chart-${valueKey}`} role="img" aria-label={`${label}, line chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 5, left: valueFormatter ? 0 : -20, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray={GRID_DASH}
              vertical={false}
              stroke={GRID_BORDER}
            />
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
              content={<LineChartTooltip chartLabel={label} formatValue={valueFormatter} />}
            />
            {referenceLine && (
              <ReferenceLine
                y={referenceLine.value}
                stroke={COLOR_GREEN}
                strokeDasharray="6 3"
                label={{
                  value: referenceLine.label,
                  position: "right",
                  fill: COLOR_GREEN,
                  fontSize: 11,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey={valueKey}
              stroke={strokeColor}
              strokeWidth={2}
              dot={{ r: 3, fill: strokeColor }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
