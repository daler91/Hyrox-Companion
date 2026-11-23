import { UtensilsCrossed } from "lucide-react";

import { LoadErrorCard } from "@/components/LoadErrorCard";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { queryLoadState } from "@/lib/queryLoadState";

import { AnalyticsEmptyCard } from "./AnalyticsEmptyState";
import { FuellingCorrelationCard } from "./FuellingCorrelationCard";
import { IntakeVsTrainingChart } from "./IntakeVsTrainingChart";
import { useFuellingAnalytics } from "./useFuellingAnalytics";

function EmptyState() {
  return (
    <AnalyticsEmptyCard testId="fuelling-tab-empty" icon={UtensilsCrossed} title="No nutrition logged in this range">
      Log food on the Nutrition page to see how your daily intake tracks against training load.
    </AnalyticsEmptyCard>
  );
}

/**
 * FR-3.1/3.2 (windows surface on the workout record) + FR-3.3 block view. This
 * tab focuses on the block view: daily intake vs training load over the selected
 * Analytics range. Gated behind featureFlags.nutritionEnabled by the parent.
 */
export function FuellingTab({ dateParams }: { readonly dateParams: string }) {
  const { query } = useFuellingAnalytics(dateParams);
  const { data, refetch } = query;
  // A first fetch paused offline is still loading, and a failed fetch is not
  // "No nutrition logged in this range". U5 (CODEBASE_ANALYSIS_2026-10-03)
  const { loading, failed, retrying } = queryLoadState(query);

  if (loading) return <LoadingSpinner />;
  if (failed) {
    return (
      <LoadErrorCard
        title="Couldn't load your fuelling data"
        onRetry={() => refetch()}
        isRetrying={retrying}
        testId="fuelling-tab-error"
      />
    );
  }
  if (!data) return <EmptyState />;

  const hasAnyIntake = data.points.some((p) => p.calories > 0);
  if (!hasAnyIntake) return <EmptyState />;

  return (
    <div className="space-y-6" data-testid="fuelling-tab">
      <IntakeVsTrainingChart points={data.points} />
      <FuellingCorrelationCard points={data.points} />
    </div>
  );
}
