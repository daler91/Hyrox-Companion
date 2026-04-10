import {
  BarChart3,
  LineChart as LineChartIcon,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";

import { type ExerciseAnalyticDay,MiniBarChart } from "@/components/analytics/MiniBarChart";
import { MiniLineChart } from "@/components/analytics/MiniLineChart";
import { Button } from "@/components/ui/button";

type TrendDirection = "up" | "down" | "flat";
const FLAT: TrendDirection = "flat";

interface ExerciseProgressionChartsProps {
  readonly selectedExercise: string | null;
  readonly allAnalytics: Record<string, ExerciseAnalyticDay[]> | undefined;
  readonly analyticsLoading: boolean;
  readonly weightLabel: string;
  readonly dLabel: string;
}

// Derive a trend label from the averages of the first and second halves of a
// data series. Extracted so the single-pass summarizer below can share it.
function deriveTrend(firstAvg: number, secondAvg: number): TrendDirection {
  if (firstAvg === 0 && secondAvg === 0) return FLAT;
  let change: number;
  if (firstAvg > 0) {
    change = (secondAvg - firstAvg) / firstAvg;
  } else {
    change = secondAvg > 0 ? 1 : 0;
  }
  if (change > 0.05) return "up";
  if (change < -0.05) return "down";
  return FLAT;
}

function TrendArrow({ trend }: Readonly<{ trend: TrendDirection }>) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-green-500 inline ml-1" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-red-500 inline ml-1" />;
  return <Minus className="h-4 w-4 text-muted-foreground inline ml-1" />;
}

function summarizeExerciseData(data: ExerciseAnalyticDay[]) {
  let hasVolume = false;
  let hasMaxWeight = false;
  let hasTotalReps = false;
  let hasTotalDistance = false;

  let totalSets = 0;
  let totalReps = 0;
  let totalVolume = 0;

  // ⚡ Bolt Performance Optimization:
  // Previously, trends for volume/weight/reps were computed by invoking
  // computeTrend() three times — each call performed two `.slice()` (creating
  // brand-new arrays) plus two `.reduce()` traversals. Combined with the
  // pre-existing totals loop, that added up to 7 passes over the data and 6
  // intermediate array allocations per render.
  //
  // This refactor folds all of that work into a single O(N) pass with zero
  // intermediate allocations by accumulating first-half and second-half sums
  // for each tracked metric inline alongside the totals. Expected impact:
  // roughly 7x fewer iterations and no transient arrays to garbage collect
  // when rendering exercise progression charts for long histories.
  const sessions = data.length;
  const mid = Math.floor(sessions / 2);
  const secondHalfCount = sessions - mid;

  let firstVolume = 0;
  let secondVolume = 0;
  let firstWeight = 0;
  let secondWeight = 0;
  let firstReps = 0;
  let secondReps = 0;

  for (let i = 0; i < sessions; i++) {
    const d = data[i];
    totalSets += d.totalSets;
    totalReps += d.totalReps;
    totalVolume += d.totalVolume;

    if (d.totalVolume > 0) hasVolume = true;
    if (d.maxWeight > 0) hasMaxWeight = true;
    if (d.totalReps > 0) hasTotalReps = true;
    if (d.totalDistance > 0) hasTotalDistance = true;

    // Split-half accumulation matches the original slice-based computeTrend:
    // first half = indices [0, mid), second half = indices [mid, sessions).
    if (i < mid) {
      firstVolume += d.totalVolume;
      firstWeight += d.maxWeight;
      firstReps += d.totalReps;
    } else {
      secondVolume += d.totalVolume;
      secondWeight += d.maxWeight;
      secondReps += d.totalReps;
    }
  }

  // computeTrend returned "flat" whenever data.length < 2. When sessions < 2,
  // `mid` is 0 and secondHalfCount is sessions, so we short-circuit to avoid
  // a divide-by-zero and to preserve the original behavior exactly.
  const canTrend = sessions >= 2;
  const volumeTrend = canTrend && hasVolume
    ? deriveTrend(firstVolume / mid, secondVolume / secondHalfCount)
    : FLAT;
  const weightTrend = canTrend && hasMaxWeight
    ? deriveTrend(firstWeight / mid, secondWeight / secondHalfCount)
    : FLAT;
  const repsTrend = canTrend && hasTotalReps
    ? deriveTrend(firstReps / mid, secondReps / secondHalfCount)
    : FLAT;

  return {
    data,
    hasVolume,
    hasMaxWeight,
    hasTotalReps,
    hasTotalDistance,
    totalSets,
    totalReps,
    totalVolume,
    sessions,
    avgVolume: sessions > 0 ? Math.round(totalVolume / sessions) : 0,
    avgReps: sessions > 0 ? Math.round(totalReps / sessions) : 0,
    volumeTrend,
    weightTrend,
    repsTrend,
  };
}

export function ExerciseProgressionCharts({
  selectedExercise,
  allAnalytics,
  analyticsLoading,
  weightLabel,
  dLabel,
}: ExerciseProgressionChartsProps) {
  const [chartMode, setChartMode] = useState<"bar" | "line">("bar");

  const analyticsData = useMemo(() => {
    if (!allAnalytics || !selectedExercise) return null;
    const data = allAnalytics[selectedExercise];
    if (!data || data.length === 0) return null;
    return summarizeExerciseData(data);
  }, [allAnalytics, selectedExercise]);

  if (!selectedExercise) {
    return (
      <div className="flex items-center justify-center py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
        <div>
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p>Select an exercise from the dropdown above to view its progression.</p>
        </div>
      </div>
    );
  }

  if (analyticsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!analyticsData || analyticsData.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">No data available for this exercise yet.</p>
    );
  }

  const ChartComponent = chartMode === "line" ? MiniLineChart : MiniBarChart;

  return (
    <div className="space-y-4">
      {/* Chart mode toggle */}
      <div className="flex justify-end gap-1">
        <Button
          variant={chartMode === "bar" ? "default" : "ghost"}
          size="sm"
          onClick={() => setChartMode("bar")}
          aria-label="Bar chart view"
        >
          <BarChart3 className="h-4 w-4" />
        </Button>
        <Button
          variant={chartMode === "line" ? "default" : "ghost"}
          size="sm"
          onClick={() => setChartMode("line")}
          aria-label="Line chart view"
        >
          <LineChartIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {analyticsData.hasVolume && (
          <ChartComponent
            data={analyticsData.data}
            valueKey="totalVolume"
            color="bg-primary/60"
            label={`Volume (reps x ${weightLabel})`}
          />
        )}
        {analyticsData.hasMaxWeight && (
          <ChartComponent
            data={analyticsData.data}
            valueKey="maxWeight"
            color="bg-purple-500/60"
            label={`Max Weight (${weightLabel})`}
          />
        )}
        {analyticsData.hasTotalReps && (
          <ChartComponent
            data={analyticsData.data}
            valueKey="totalReps"
            color="bg-blue-500/60"
            label="Total Reps"
          />
        )}
        {analyticsData.hasTotalDistance && (
          <ChartComponent
            data={analyticsData.data}
            valueKey="totalDistance"
            color="bg-green-500/60"
            label={`Total Distance (${dLabel})`}
          />
        )}
        <div className="sm:col-span-2">
          <p className="text-xs text-muted-foreground font-medium mb-2">Summary</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-2xl font-bold" data-testid="text-total-sessions">
                {analyticsData.sessions}
              </p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Sessions
              </p>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-2xl font-bold" data-testid="text-total-sets">
                {analyticsData.totalSets}
              </p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Sets
              </p>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-2xl font-bold" data-testid="text-total-reps">
                {analyticsData.totalReps}
              </p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Avg Reps / Session <TrendArrow trend={analyticsData.repsTrend} />
              </p>
              <p className="text-sm text-muted-foreground mt-1">{analyticsData.avgReps}/session</p>
            </div>
            {analyticsData.hasVolume && (
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-2xl font-bold" data-testid="text-total-volume">
                  {Math.round(analyticsData.totalVolume).toLocaleString()}
                </p>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Volume ({weightLabel}) <TrendArrow trend={analyticsData.volumeTrend} />
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {analyticsData.avgVolume.toLocaleString()}/session
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
