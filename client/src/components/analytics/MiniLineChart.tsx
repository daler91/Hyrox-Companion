import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { MUTED_FG, GRID_BORDER, GRID_DASH, COLOR_GREEN, COLOR_PRIMARY, CHART_CARD_CLASS, formatChartDate } from "./chartConstants";

const getStrokeColor = (colorStr: string): string => {
  if (colorStr.includes("primary")) return COLOR_PRIMARY;
  if (colorStr.includes("purple")) return "#a855f7";
  if (colorStr.includes("blue")) return "#3b82f6";
  if (colorStr.includes("green")) return COLOR_GREEN;
  if (colorStr.includes("amber")) return "#f59e0b";
  if (colorStr.includes("red")) return "#ef4444";
  return "#64748b";
};

function LineChartTooltip({ active, payload, chartLabel }: { active?: boolean; payload?: Array<{ value: number; payload?: Record<string, unknown> }>; chartLabel?: string }) {
  if (!active || !payload?.length) return null;

  const firstPayload = payload[0]?.payload;
  const dateStr = String(firstPayload?.date ?? firstPayload?.weekStart ?? "");

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        {dateStr ? formatChartDate(dateStr) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">{chartLabel}:</span>
        <span className="font-medium">{payload[0]?.value != null ? Math.round(payload[0].value * 10) / 10 : "N/A"}</span>
      </p>
    </div>
  );
}

export function MiniLineChart({
  data,
  xKey = "date",
  valueKey,
  color,
  label,
  referenceLine,
}: Readonly<{
  data: readonly object[];
  xKey?: string;
  valueKey: string;
  color: string;
  label: string;
  referenceLine?: { value: number; label: string };
}>) {
  if (data.length === 0) return null;

  const strokeColor = getStrokeColor(color);

  return (
    <div className={CHART_CARD_CLASS}>
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="h-[200px] w-full" data-testid={`line-chart-${valueKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data as object[]}
            margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
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
            />
            <Tooltip
              cursor={{ stroke: MUTED_FG, strokeDasharray: GRID_DASH }}
              content={<LineChartTooltip chartLabel={label} />}
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
}
