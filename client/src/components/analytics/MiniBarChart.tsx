import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ExerciseAnalyticDay {
  date: string;
  totalVolume: number;
  maxWeight: number;
  totalSets: number;
  totalReps: number;
  totalDistance: number;
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Convert Tailwind classes like "bg-primary/60" to hex colors for Recharts
// Fallback to basic colors if specific classes aren't matched
const getFillColor = (colorStr: string) => {
  if (colorStr.includes("primary")) return "#ea580c"; // Matches our orange primary
  if (colorStr.includes("purple")) return "#a855f7";
  if (colorStr.includes("blue")) return "#3b82f6";
  if (colorStr.includes("green")) return "#22c55e";
  return "#64748b"; // muted fallback
};

const CustomTooltip = ({ active, payload, chartLabel }: { active?: boolean; payload?: Array<{ value: number; payload?: ExerciseAnalyticDay }>; chartLabel?: string }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        {payload[0]?.payload?.date ? formatDate(payload[0].payload.date) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">{chartLabel}:</span>
        <span className="font-medium">{payload[0]?.value}</span>
      </p>
    </div>
  );
};

export function MiniBarChart({
  data,
  valueKey,
  color,
  label,
}: Readonly<{
  data: ExerciseAnalyticDay[];
  valueKey: keyof ExerciseAnalyticDay;
  color: string;
  label: string;
}>) {
  if (data.length === 0) return null;

  const fillColor = getFillColor(color);

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="h-[200px] w-full" data-testid={`chart-${valueKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
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
              cursor={{ fill: "hsl(var(--muted)/0.5)" }}
              content={<CustomTooltip chartLabel={label} />}
            />
            <Bar
              dataKey={valueKey as string}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            >
              {data.map((entry) => (
                <Cell
                  key={`cell-${entry.date}`}
                  fill={fillColor}
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export type { ExerciseAnalyticDay };
