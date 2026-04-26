import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSwitchRow } from "./PreferenceRows";

interface WorkoutReviewCardProps {
  readonly showAdherenceInsights: boolean;
  readonly onShowAdherenceInsightsChange: (checked: boolean) => void;
}

export function WorkoutReviewCard({
  showAdherenceInsights,
  onShowAdherenceInsightsChange,
}: WorkoutReviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Workout Review</CardTitle>
        <CardDescription>Control adherence indicators on timeline and detail views</CardDescription>
      </CardHeader>
      <CardContent>
        <PreferenceSwitchRow
          id="adherence-insights-switch"
          label="Show adherence insights"
          description="Display adherence badges and planned-vs-actual guidance in review surfaces."
          checked={showAdherenceInsights}
          onCheckedChange={onShowAdherenceInsightsChange}
          testId="switch-show-adherence-insights"
        />
      </CardContent>
    </Card>
  );
}
