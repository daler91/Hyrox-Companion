import { BarChart3, Loader2 } from "lucide-react";

import { OverviewStatsGrid } from "./training-overview/OverviewStatsGrid";
import { OverviewTrendCharts } from "./training-overview/OverviewTrendCharts";
import { useTrainingOverviewData } from "./training-overview/useTrainingOverviewData";
import { WeeklyWorkoutsChart } from "./training-overview/WeeklyWorkoutsChart";
import { WorkoutHeatmap } from "./WorkoutHeatmap";

interface TrainingOverviewTabProps {
  readonly dateParams: string;
  readonly weeklyGoal?: number;
}

export function TrainingOverviewTab({ dateParams, weeklyGoal }: TrainingOverviewTabProps) {
  const { overview, isLoading, stats, previousStats, rpeData, durationData, annotationBands } =
    useTrainingOverviewData(dateParams);

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
      {stats && <OverviewStatsGrid stats={stats} previousStats={previousStats} />}
      <WeeklyWorkoutsChart
        weeklySummaries={overview.weeklySummaries}
        weeklyGoal={weeklyGoal}
        annotationBands={annotationBands}
      />
      <OverviewTrendCharts rpeData={rpeData} durationData={durationData} />
      <WorkoutHeatmap workoutDates={overview.workoutDates} />
    </div>
  );
}
