import { BarChart3 } from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { AcwrTrendChart } from "./training-overview/AcwrTrendChart";
import { FormMonotonyTrendCharts } from "./training-overview/FormMonotonyTrendCharts";
import { ObjectiveLoadTrendCharts } from "./training-overview/ObjectiveLoadTrendCharts";
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
        <LoadingSpinner iconClassName="h-6 w-6" />
      </div>
    );
  }

  const hasTrainingLoadData = overview?.trainingLoad?.trend.some((point) => point.utss > 0);

  if (!overview || (overview.weeklySummaries.length === 0 && !hasTrainingLoadData)) {
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
      {overview.trainingLoad && <AcwrTrendChart trainingLoad={overview.trainingLoad} />}
      {overview.trainingLoad && <FormMonotonyTrendCharts trainingLoad={overview.trainingLoad} />}
      {overview.trainingLoad && <ObjectiveLoadTrendCharts trainingLoad={overview.trainingLoad} />}
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
