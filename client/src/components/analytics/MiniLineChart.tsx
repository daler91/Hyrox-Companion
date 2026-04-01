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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataPoint = Record<string, any>;

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const getStrokeColor = (colorStr: string) => {
  if (colorStr.includes("primary")) return "#ea580c";
  if (colorStr.includes("purple")) return "#a855f7";
  if (colorStr.includes("blue")) return "#3b82f6";
  if (colorStr.includes("green")) return "#22c55e";
  if (colorStr.includes("amber")) return "#f59e0b";
  if (colorStr.includes("red")) return "#ef4444";
  return "#64748b";
};

const CustomTooltip = ({ active, payload, chartLabel }: { active?: boolean; payload?: Array<{ value: number; payload?: DataPoint }>; chartLabel?: string }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        {payload[0]?.payload?.date ? formatDate(payload[0].payload.date as string) : payload[0]?.payload?.weekStart ? formatDate(payload[0].payload.weekStart as string) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">{chartLabel}:</span>
        <span className="font-medium">{payload[0]?.value != null ? Math.round(payload[0].value * 10) / 10 : "N/A"}</span>
      </p>
    </div>
  );
};

export function MiniLineChart({
  data,
  xKey = "date",
  valueKey,
  color,
  label,
  referenceLine,
}: Readonly<{
  data: DataPoint[];
  xKey?: string;
  valueKey: string;
  color: string;
  label: string;
  referenceLine?: { value: number; label: string };
}>) {
  if (data.length === 0) return null;

  const strokeColor = getStrokeColor(color);

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="h-[200px] w-full" data-testid={`line-chart-${valueKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey={xKey}
              tickFormatter={(v: string) => formatDate(v)}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
              content={<CustomTooltip chartLabel={label} />}
            />
            {referenceLine && (
              <ReferenceLine
                y={referenceLine.value}
                stroke="#22c55e"
                strokeDasharray="6 3"
                label={{
                  value: referenceLine.label,
                  position: "right",
                  fill: "#22c55e",
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
