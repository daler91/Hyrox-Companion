import type { BlockViewPoint } from "@shared/schema";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
  MUTED_FG,
} from "./chartConstants";

function IntakeTooltip({
  active,
  payload,
}: Readonly<{
  active?: boolean;
  payload?: Array<{ payload?: BlockViewPoint }>;
}>) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">{formatChartDate(point.date)}</p>
      <p>
        <span className="text-muted-foreground mr-2">Calories:</span>
        <span className="font-medium">{point.calories}</span>
      </p>
      <p>
        <span className="text-muted-foreground mr-2">Protein:</span>
        <span className="font-medium">{point.protein} g</span>
      </p>
      <p>
        <span className="text-muted-foreground mr-2">UTSS:</span>
        <span className="font-medium">{point.utss}</span>
      </p>
    </div>
  );
}

/**
 * FR-3.3 — daily calorie intake (bars) against training UTSS (line) on a dual
 * axis. Calories use the left axis; UTSS the right. Follows AcwrTrendChart's
 * Recharts conventions (chartConstants, dashed empty state when too sparse).
 */
export function IntakeVsTrainingChart({ points }: Readonly<{ points: readonly BlockViewPoint[] }>) {
  const hasData = points.length > 1;

  return (
    <div className={CHART_CARD_CLASS} data-testid="intake-vs-training-card">
      <div>
        <p className="text-sm font-semibold">Intake vs training load</p>
        <p className="text-xs text-muted-foreground">Daily calories (bars) against training UTSS (line)</p>
      </div>

      {hasData ? (
        <div
          className="h-[200px] w-full sm:h-[260px]"
          data-testid="chart-intake-vs-training"
          role="img"
          aria-label={`Combined bar and line chart of daily calorie intake against training UTSS over ${points.length} days`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 5 }}>
              <CartesianGrid strokeDasharray={GRID_DASH} vertical={false} stroke={GRID_BORDER} />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: MUTED_FG }}
              />
              <YAxis
                yAxisId="kcal"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: MUTED_FG }}
              />
              <YAxis
                yAxisId="utss"
                orientation="right"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: MUTED_FG }}
              />
              <Tooltip cursor={{ fill: "hsl(var(--muted)/0.3)" }} content={<IntakeTooltip />} />
              <Bar
                yAxisId="kcal"
                dataKey="calories"
                name="Calories"
                fill={COLOR_PRIMARY}
                fillOpacity={0.75}
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="utss"
                type="monotone"
                dataKey="utss"
                name="UTSS"
                stroke={COLOR_GREEN}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
          data-testid="intake-vs-training-empty"
        >
          Log food across a few training days to see intake against load.
        </div>
      )}
    </div>
  );
}
