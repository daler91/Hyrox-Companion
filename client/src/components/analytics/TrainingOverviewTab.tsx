import type { TrainingOverview } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, Flame, Loader2, Zap } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "@/lib/api";

import { CHART_CARD_CLASS, COLOR_GREEN, COLOR_PRIMARY, formatChartDate,GRID_BORDER, GRID_DASH, MUTED_CURSOR, MUTED_FG } from "./chartConstants";
import { DeltaIndicator } from "./DeltaIndicator";
import { MiniLineChart } from "./MiniLineChart";
import { WorkoutHeatmap } from "./WorkoutHeatmap";

interface TrainingOverviewTabProps {
  readonly dateParams: string;
  readonly weeklyGoal?: number;
}

function WeeklyTooltip({ active, payload }: Readonly<{ active?: boolean; payload?: Array<{ value: number; payload?: { weekStart: string } }> }>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        Week of {payload[0]?.payload?.weekStart ? formatChartDate(payload[0].payload.weekStart) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">Workouts:</span>
        <span className="font-medium">{payload[0]?.value}</span>
      </p>
    </div>
  );
}

export function TrainingOverviewTab({ dateParams, weeklyGoal }: TrainingOverviewTabProps) {
  const { data: overview, isLoading } = useQuery<TrainingOverview>({
    queryKey: ["/api/v1/training-overview", dateParams],
    queryFn: () => api.analytics.getTrainingOverview(dateParams),
  });

  // Current-period and previous-period stats come pre-computed from the
  // server (services/analyticsService.computeOverviewStats) so the client
  // doesn't repeat the aggregation and the two windows use identical
  // logic for an apples-to-apples delta comparison.
  const stats = overview?.currentStats ?? null;
  const previousStats = overview?.previousStats;

  // ⚡ Memoize chart data in a single O(N) pass instead of two separate
  // .filter().map() chains (4 array traversals → 1). This also stabilises
  // array references so MiniLineChart can skip re-renders via React.memo.
  const { rpeData, durationData } = useMemo(() => {
    if (!overview) return { rpeData: [] as Array<{ weekStart: string; avgRpe: number | null }>, durationData: [] as Array<{ weekStart: string; avgDuration: number }> };
    const rpe: Array<{ weekStart: string; avgRpe: number | null }> = [];
    const duration: Array<{ weekStart: string; avgDuration: number }> = [];
    for (const w of overview.weeklySummaries) {
      if (w.avgRpe !== null) {
        rpe.push({ weekStart: w.weekStart, avgRpe: w.avgRpe });
      }
      if (w.totalDuration > 0) {
        duration.push({
          weekStart: w.weekStart,
          avgDuration: w.workoutCount > 0 ? Math.round(w.totalDuration / w.workoutCount) : 0,
        });
      }
    }
    return { rpeData: rpe, durationData: duration };
  }, [overview]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!overview || overview.weeklySummaries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
        <div>
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p>No workout data yet. Log some workouts to see your training overview.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats with "vs previous period" deltas */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <BarChart3 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold" data-testid="text-avg-workouts">{stats.avgPerWeek}</p>
                {previousStats ? (
                  <DeltaIndicator
                    current={stats.avgPerWeek}
                    previous={previousStats.avgPerWeek}
                    testIdSuffix="avg-workouts"
                  />
                ) : null}
              </div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg / Week</p>
            </div>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <Zap className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold" data-testid="text-total-workouts">{stats.totalWorkouts}</p>
                {previousStats ? (
                  <DeltaIndicator
                    current={stats.totalWorkouts}
                    previous={previousStats.totalWorkouts}
                    testIdSuffix="total-workouts"
                  />
                ) : null}
              </div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Workouts</p>
            </div>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <Clock className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold" data-testid="text-avg-duration">{stats.avgDuration}<span className="text-sm font-normal text-muted-foreground">min</span></p>
                {previousStats ? (
                  <DeltaIndicator
                    current={stats.avgDuration}
                    previous={previousStats.avgDuration}
                    unit="min"
                    testIdSuffix="avg-duration"
                  />
                ) : null}
              </div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg Duration</p>
            </div>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <Flame className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold" data-testid="text-avg-rpe">{stats.avgRpe ?? "—"}</p>
                {previousStats && stats.avgRpe !== null && previousStats.avgRpe !== null ? (
                  <DeltaIndicator
                    current={stats.avgRpe}
                    previous={previousStats.avgRpe}
                    lowerIsBetter
                    testIdSuffix="avg-rpe"
                  />
                ) : null}
              </div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg RPE</p>
            </div>
          </div>
        </div>
      )}
      {previousStats ? (
        <p className="text-xs text-muted-foreground -mt-2">
          Deltas compare the current period to the equivalent window immediately before it.
        </p>
      ) : null}

      {/* Weekly Workouts Bar Chart */}
      <div className={CHART_CARD_CLASS}>
        <p className="text-sm font-semibold">Weekly Workouts</p>
        <div className="h-[200px] w-full" data-testid="chart-weekly-workouts">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={overview.weeklySummaries}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
            >
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
              <Tooltip
                cursor={{ fill: MUTED_CURSOR }}
                content={<WeeklyTooltip />}
              />
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
                {overview.weeklySummaries.map((entry) => (
                  <Cell
                    key={entry.weekStart}
                    fill={weeklyGoal && entry.workoutCount >= weeklyGoal ? COLOR_GREEN : COLOR_PRIMARY}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* RPE and Duration trends side by side */}
      <div className="grid gap-6 sm:grid-cols-2">
        {rpeData.length > 1 && (
          <MiniLineChart
            data={rpeData}
            xKey="weekStart"
            valueKey="avgRpe"
            color="bg-red-500"
            label="Avg RPE (per week)"
          />
        )}
        {durationData.length > 1 && (
          <MiniLineChart
            data={durationData}
            xKey="weekStart"
            valueKey="avgDuration"
            color="bg-blue-500"
            label="Avg Duration (min)"
          />
        )}
      </div>

      {/* Heatmap */}
      <WorkoutHeatmap workoutDates={overview.workoutDates} />
    </div>
  );
}
