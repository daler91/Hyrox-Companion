import { UtensilsCrossed } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { FuellingCorrelationCard } from "./FuellingCorrelationCard";
import { IntakeVsTrainingChart } from "./IntakeVsTrainingChart";
import { useFuellingAnalytics } from "./useFuellingAnalytics";

function EmptyState() {
  return (
    <Card data-testid="fuelling-tab-empty">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <UtensilsCrossed className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">No nutrition logged in this range</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Log food on the Nutrition page to see how your daily intake tracks against training load.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * FR-3.1/3.2 (windows surface on the workout record) + FR-3.3 block view. This
 * tab focuses on the block view: daily intake vs training load over the selected
 * Analytics range. Gated behind featureFlags.nutritionEnabled by the parent.
 */
export function FuellingTab({ dateParams }: { readonly dateParams: string }) {
  const { query } = useFuellingAnalytics(dateParams);
  const { data, isLoading, isError } = query;

  if (isLoading && !data) return <LoadingSpinner />;
  if (isError || !data) return <EmptyState />;

  const hasAnyIntake = data.points.some((p) => p.calories > 0);
  if (!hasAnyIntake) return <EmptyState />;

  return (
    <div className="space-y-6" data-testid="fuelling-tab">
      <IntakeVsTrainingChart points={data.points} />
      <FuellingCorrelationCard points={data.points} />
    </div>
  );
}
