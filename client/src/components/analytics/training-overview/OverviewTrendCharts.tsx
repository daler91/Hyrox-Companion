import { MiniLineChart } from "../MiniLineChart";

interface OverviewTrendChartsProps {
  readonly rpeData: Array<{ weekStart: string; avgRpe: number | null }>;
  readonly durationData: Array<{ weekStart: string; avgDuration: number }>;
}

export function OverviewTrendCharts({ rpeData, durationData }: OverviewTrendChartsProps) {
  return (
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
  );
}
