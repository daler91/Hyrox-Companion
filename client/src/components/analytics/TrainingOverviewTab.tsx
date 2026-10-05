import { BarChart3 } from "lucide-react";

import { LoadErrorCard } from "@/components/LoadErrorCard";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { AcwrTrendChart } from "./training-overview/AcwrTrendChart";
import { BodySystemLoadCard } from "./training-overview/BodySystemLoadCard";
import { FormMonotonyTrendCharts } from "./training-overview/FormMonotonyTrendCharts";
import { ObjectiveLoadTrendCharts } from "./training-overview/ObjectiveLoadTrendCharts";
import { OverviewAnalysisHeader } from "./training-overview/OverviewAnalysisHeader";
import { OverviewStatsGrid } from "./training-overview/OverviewStatsGrid";
import { OverviewTrendCharts } from "./training-overview/OverviewTrendCharts";
import { useOverviewAnalysis } from "./training-overview/useOverviewAnalysis";
import { useTrainingOverviewData } from "./training-overview/useTrainingOverviewData";
import { WeeklyWorkoutsChart } from "./training-overview/WeeklyWorkoutsChart";
import { WorkoutHeatmap } from "./WorkoutHeatmap";

interface TrainingOverviewTabProps {
  readonly dateParams: string;
  readonly weeklyGoal?: number;
}

export function TrainingOverviewTab({ dateParams, weeklyGoal }: TrainingOverviewTabProps) {
  const {
    overview,
    isLoading,
    loadFailed,
    isRetrying,
    retry,
    stats,
    previousStats,
    rpeData,
    durationData,
    mileageData,
    annotationBands,
  } = useTrainingOverviewData(dateParams);
  const analysis = useOverviewAnalysis();
  const sections = analysis.sections;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner iconClassName="h-6 w-6" />
      </div>
    );
  }

  // A failed fetch is not "No workout data yet". U5 (CODEBASE_ANALYSIS_2026-10-03)
  if (loadFailed) {
    return (
      <LoadErrorCard
        title="Couldn't load your training overview"
        onRetry={() => retry()}
        isRetrying={isRetrying}
        testId="training-overview-error"
      />
    );
  }

  const hasTrainingLoadData = overview?.trainingLoad?.trend.some((point) => point.utss > 0);
  // `workoutDates` only covers the selected range, so the heatmap needs its
  // start to tell "no data" from "rest day" (CL6 (CODEBASE_ANALYSIS_2026-10-03)).
  const rangeStart = new URLSearchParams(dateParams).get("from") ?? undefined;

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
      <OverviewAnalysisHeader
        hasAnalysis={analysis.hasAnalysis}
        isGenerating={analysis.isGenerating}
        generatedAt={analysis.generatedAt}
        stale={analysis.stale}
        error={analysis.error}
        canGenerate={analysis.canGenerate}
        onGenerate={analysis.regenerate}
      />
      {stats && <OverviewStatsGrid stats={stats} previousStats={previousStats} />}
      {overview.trainingLoad && (
        <AcwrTrendChart trainingLoad={overview.trainingLoad} explanation={sections?.trainingLoad} />
      )}
      {overview.bodySystemLoad && (
        <BodySystemLoadCard
          bodySystemLoad={overview.bodySystemLoad}
          explanation={sections?.bodySystems}
        />
      )}
      {overview.trainingLoad && (
        <FormMonotonyTrendCharts
          trainingLoad={overview.trainingLoad}
          explanation={sections?.formMonotony}
        />
      )}
      {overview.trainingLoad && (
        <ObjectiveLoadTrendCharts
          trainingLoad={overview.trainingLoad}
          explanation={sections?.objectiveLoad}
        />
      )}
      <WeeklyWorkoutsChart
        weeklySummaries={overview.weeklySummaries}
        weeklyGoal={weeklyGoal}
        annotationBands={annotationBands}
        explanation={sections?.weeklyWorkouts}
      />
      <OverviewTrendCharts
        rpeData={rpeData}
        durationData={durationData}
        mileageData={mileageData}
        explanation={sections?.rpeDuration}
      />
      <WorkoutHeatmap
        workoutDates={overview.workoutDates}
        rangeStart={rangeStart}
        explanation={sections?.consistency}
      />
    </div>
  );
}
