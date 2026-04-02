import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, BarChart3, Clock, Flame, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { TrainingOverview } from "@shared/schema";
import { MiniLineChart } from "./MiniLineChart";
import { WorkoutHeatmap } from "./WorkoutHeatmap";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

const MUTED_FG = "hsl(var(--muted-foreground))";
const GRID_BORDER = "hsl(var(--border))";
const GRID_DASH = "3 3";

interface TrainingOverviewTabProps {
  readonly dateParams: string;
  readonly weeklyGoal?: number;
}

function formatWeek(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const WeeklyTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload?: { weekStart: string } }> }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">
        Week of {payload[0]?.payload?.weekStart ? formatWeek(payload[0].payload.weekStart) : ""}
      </p>
      <p>
        <span className="text-muted-foreground mr-2">Workouts:</span>
        <span className="font-medium">{payload[0]?.value}</span>
      </p>
    </div>
  );
};

export function TrainingOverviewTab({ dateParams, weeklyGoal }: TrainingOverviewTabProps) {
  const { data: overview, isLoading } = useQuery<TrainingOverview>({
    queryKey: ["/api/v1/training-overview", dateParams],
    queryFn: () => api.analytics.getTrainingOverview(dateParams),
  });

  const stats = useMemo(() => {
    if (!overview || overview.weeklySummaries.length === 0) return null;
    const weeks = overview.weeklySummaries;
    const totalWorkouts = weeks.reduce((s, w) => s + w.workoutCount, 0);
    const avgPerWeek = Math.round((totalWorkouts / weeks.length) * 10) / 10;
    const totalDuration = weeks.reduce((s, w) => s + w.totalDuration, 0);
    const avgDuration = totalWorkouts > 0 ? Math.round(totalDuration / totalWorkouts) : 0;

    const rpeWeeks = weeks.filter((w) => w.avgRpe !== null);
    const avgRpe = rpeWeeks.length > 0
      ? Math.round((rpeWeeks.reduce((s, w) => s + (w.avgRpe ?? 0), 0) / rpeWeeks.length) * 10) / 10
      : null;

    return { avgPerWeek, avgDuration, avgRpe, totalWorkouts };
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

  const rpeData = overview.weeklySummaries
    .filter((w) => w.avgRpe !== null)
    .map((w) => ({ weekStart: w.weekStart, avgRpe: w.avgRpe }));

  const durationData = overview.weeklySummaries
    .filter((w) => w.totalDuration > 0)
    .map((w) => ({
      weekStart: w.weekStart,
      avgDuration: w.workoutCount > 0 ? Math.round(w.totalDuration / w.workoutCount) : 0,
    }));

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <BarChart3 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-avg-workouts">{stats.avgPerWeek}</p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg / Week</p>
            </div>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <Zap className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-total-workouts">{stats.totalWorkouts}</p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Workouts</p>
            </div>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <Clock className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-avg-duration">{stats.avgDuration}<span className="text-sm font-normal text-muted-foreground">min</span></p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg Duration</p>
            </div>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
            <Flame className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-avg-rpe">{stats.avgRpe ?? "—"}</p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg RPE</p>
            </div>
          </div>
        </div>
      )}

      {/* Weekly Workouts Bar Chart */}
      <div className="space-y-3 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
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
                tickFormatter={formatWeek}
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
                cursor={{ fill: "hsl(var(--muted)/0.5)" }}
                content={<WeeklyTooltip />}
              />
              {weeklyGoal && (
                <ReferenceLine
                  y={weeklyGoal}
                  stroke="#22c55e"
                  strokeDasharray="6 3"
                  label={{
                    value: `Goal: ${weeklyGoal}`,
                    position: "right",
                    fill: "#22c55e",
                    fontSize: 11,
                  }}
                />
              )}
              <Bar dataKey="workoutCount" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {overview.weeklySummaries.map((entry) => (
                  <Cell
                    key={entry.weekStart}
                    fill={weeklyGoal && entry.workoutCount >= weeklyGoal ? "#22c55e" : "#ea580c"}
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
