import type { WeeklySummary } from "@shared/schema";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_CARD_CLASS,
  COLOR_GREEN,
  COLOR_PRIMARY,
  formatChartDate,
  GRID_BORDER,
  GRID_DASH,
  MUTED_CURSOR,
  MUTED_FG,
} from "../chartConstants";
import type { AnnotationBand } from "./utils";
import { ANNOTATION_FILL } from "./utils";

function WeeklyTooltip({
  active,
  payload,
}: Readonly<{
  active?: boolean;
  payload?: Array<{ value: number; payload?: { weekStart: string } }>;
}>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        Week of{" "}
        {payload[0]?.payload?.weekStart ? formatChartDate(payload[0].payload.weekStart) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">Workouts:</span>
        <span className="font-medium">{payload[0]?.value}</span>
      </p>
    </div>
  );
}

interface WeeklyWorkoutsChartProps {
  readonly weeklySummaries: WeeklySummary[];
  readonly weeklyGoal?: number;
  readonly annotationBands: AnnotationBand[];
}

export function WeeklyWorkoutsChart({
  weeklySummaries,
  weeklyGoal,
  annotationBands,
}: WeeklyWorkoutsChartProps) {
  return (
    <div className={CHART_CARD_CLASS}>
      <p className="text-sm font-semibold">Weekly Workouts</p>
      <div className="h-[200px] w-full" data-testid="chart-weekly-workouts">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeklySummaries} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray={GRID_DASH} vertical={false} stroke={GRID_BORDER} />
            <XAxis
              dataKey="weekStart"
              tickFormatter={formatChartDate}
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
              allowDecimals={false}
            />
            <Tooltip cursor={{ fill: MUTED_CURSOR }} content={<WeeklyTooltip />} />
            {annotationBands.map((band) => (
              <ReferenceArea
                key={band.id}
                x1={band.x1}
                x2={band.x2}
                fill={ANNOTATION_FILL[band.type]}
                ifOverflow="extendDomain"
              />
            ))}
            {weeklyGoal && (
              <ReferenceLine
                y={weeklyGoal}
                stroke={COLOR_GREEN}
                strokeDasharray="6 3"
                label={{
                  value: `Goal: ${weeklyGoal}`,
                  position: "right",
                  fill: COLOR_GREEN,
                  fontSize: 11,
                }}
              />
            )}
            <Bar dataKey="workoutCount" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {weeklySummaries.map((entry) => (
                <Cell
                  key={entry.weekStart}
                  fill={
                    weeklyGoal && entry.workoutCount >= weeklyGoal ? COLOR_GREEN : COLOR_PRIMARY
                  }
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
