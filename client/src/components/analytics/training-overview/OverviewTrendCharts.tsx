import { formatDistance, metersToUserDistance } from "@shared/unitConversion";
import { useCallback, useMemo } from "react";

import { useUnitPreferences } from "@/hooks/useUnitPreferences";

import { MiniLineChart } from "../MiniLineChart";
import { ChartExplanation } from "./ChartExplanation";

interface OverviewTrendChartsProps {
  readonly rpeData: Array<{ weekStart: string; avgRpe: number | null }>;
  readonly durationData: Array<{ weekStart: string; avgDuration: number }>;
  readonly mileageData: Array<{ weekStart: string; runningMeters: number }>;
  readonly explanation?: string;
}

export function OverviewTrendCharts({
  rpeData,
  durationData,
  mileageData,
  explanation,
}: OverviewTrendChartsProps) {
  const { distanceUnit, distanceLabel } = useUnitPreferences();
  // The series stays in metres so it matches the stat card exactly; the axis
  // and tooltip convert on the way out.
  // Memoized so `data`/`valueFormatter` stay referentially stable across
  // unrelated re-renders (e.g. annotations refetch, AI overview-analysis
  // query state) — MiniLineChart's own React.memo relies on that to skip the
  // Recharts re-render (see its "prevents expensive Recharts re-renders"
  // comment), which a fresh array/callback on every render would defeat.
  const mileageInDisplayUnit = useMemo(
    () =>
      mileageData.map((week) => ({
        weekStart: week.weekStart,
        runningMeters: metersToUserDistance(week.runningMeters, distanceUnit),
      })),
    [mileageData, distanceUnit],
  );
  const formatMileage = useCallback(
    (value: number) => formatDistance(value, distanceUnit, 1),
    [distanceUnit],
  );
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
      {mileageInDisplayUnit.length > 1 && (
        <MiniLineChart
          data={mileageInDisplayUnit}
          xKey="weekStart"
          valueKey="runningMeters"
          color="bg-emerald-600"
          label={`Running (${distanceLabel} per week)`}
          valueFormatter={formatMileage}
        />
      )}
      <ChartExplanation explanation={explanation} />
    </div>
  );
}
