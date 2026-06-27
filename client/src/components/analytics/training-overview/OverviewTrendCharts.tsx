import { MiniLineChart } from "../MiniLineChart";
import { ChartExplanation } from "./ChartExplanation";

interface OverviewTrendChartsProps {
  readonly rpeData: Array<{ weekStart: string; avgRpe: number | null }>;
  readonly durationData: Array<{ weekStart: string; avgDuration: number }>;
  readonly explanation?: string;
}

export function OverviewTrendCharts({ rpeData, durationData, explanation }: OverviewTrendChartsProps) {
  return (
    <div className="space-y-6" data-testid="overview-trend-charts">
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
      <ChartExplanation explanation={explanation} />
    </div>
  );
}
