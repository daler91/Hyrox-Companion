import { metersPerSecond } from "@shared/maf";
import { formatPace } from "@shared/unitConversion";
import { useQuery } from "@tanstack/react-query";
import { Activity, HeartPulse } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAuth } from "@/hooks/useAuth";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { readAnalyticsSnapshot, useWriteAnalyticsSnapshot } from "@/lib/analyticsSnapshot";
import { api, type MafTestsListResponse, QUERY_KEYS } from "@/lib/api";
import { formatSecondsToMmSs } from "@/lib/statsUtils";

import { LastUpdatedNote } from "./LastUpdatedNote";
import { buildComplianceTrendData, buildPaceTrendData, buildTestRows, classificationMeta } from "./mafTrend.helpers";
import { MiniLineChart } from "./MiniLineChart";

const TONE_BADGE_CLASS: Record<"green" | "amber" | "red", string> = {
  green: "border-green-500/40 text-green-600",
  amber: "border-amber-500/40 text-amber-600",
  red: "border-red-500/40 text-red-600",
};

function formatTestDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function EmptyState() {
  return (
    <Card data-testid="maf-trend-empty">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <HeartPulse className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">No MAF tests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a fixed distance or time at your MAF heart-rate ceiling, then open that workout and
            tag it as a MAF test. Your compliance trend builds here over time.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function MafTrendTab() {
  const { distanceUnit } = useUnitPreferences();
  const { user } = useAuth();

  // Per-user localStorage snapshot so the trend paints instantly on open
  // instead of a full-screen spinner, then revalidates against the DB.
  const snapshotKey = user?.id ? `fitai-maf-tests-cache:${user.id}` : null;
  const placeholder = useMemo(
    () => (snapshotKey ? readAnalyticsSnapshot<MafTestsListResponse>(snapshotKey) : undefined),
    [snapshotKey],
  );
  const { data, isLoading, isPlaceholderData } = useQuery<MafTestsListResponse>({
    queryKey: QUERY_KEYS.mafTests,
    queryFn: () => api.mafTests.list(),
    placeholderData: placeholder,
  });
  useWriteAnalyticsSnapshot(snapshotKey, data, isPlaceholderData);

  if (isLoading && !data) return <LoadingSpinner />;

  const rows = buildTestRows(data);
  if (rows.length === 0) return <EmptyState />;

  const trend = buildComplianceTrendData(data?.analysis ?? []);
  const paceTrend = buildPaceTrendData(rows, distanceUnit);
  const paceUnit = distanceUnit === "miles" ? "mi" : "km";
  const latest = rows[0];
  const latestMeta = classificationMeta(latest.classification);

  return (
    <div className="space-y-6" data-testid="maf-trend-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5" data-testid="maf-trend-count">
          <Activity className="h-3 w-3" aria-hidden="true" />
          {rows.length} MAF test{rows.length === 1 ? "" : "s"}
        </Badge>
        {latest.compliancePct != null && (
          <Badge variant="outline" className={`gap-1.5 ${TONE_BADGE_CLASS[latestMeta.tone]}`} data-testid="maf-trend-latest">
            Latest: {latest.compliancePct}% · {latestMeta.label}
          </Badge>
        )}
      </div>

      <LastUpdatedNote value={latest.date} mode="date" />

      {trend.length >= 2 ? (
        <MiniLineChart
          data={trend}
          valueKey="compliancePct"
          color="green"
          label="MAF ceiling compliance (%)"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Log at least two MAF tests with heart-rate data to see your compliance trend.
        </p>
      )}

      {paceTrend.length >= 2 && (
        <MiniLineChart
          data={paceTrend}
          valueKey="secondsPerUnit"
          color="blue"
          label={`Pace (min/${paceUnit}) — lower is faster`}
          valueFormatter={(seconds) => formatSecondsToMmSs(seconds)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test history</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((row) => {
            const meta = classificationMeta(row.classification);
            const mps = metersPerSecond(row.distanceMeters, row.durationSeconds);
            const detailParts: string[] = [];
            if (mps != null) detailParts.push(formatPace(mps, distanceUnit));
            if (row.durationSeconds != null) detailParts.push(formatSecondsToMmSs(row.durationSeconds));
            if (row.avgHeartRate != null) detailParts.push(`${row.avgHeartRate} bpm`);
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                data-testid={`maf-test-row-${row.id}`}
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{formatTestDate(row.date)}</span>
                  {detailParts.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums" data-testid={`maf-test-row-detail-${row.id}`}>
                      {detailParts.join(" · ")}
                    </p>
                  )}
                </div>
                {row.compliancePct == null ? (
                  <span className="text-xs text-muted-foreground">No HR data</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-sm tabular-nums">{row.compliancePct}%</span>
                    <Badge variant="outline" className={TONE_BADGE_CLASS[meta.tone]}>
                      {meta.label}
                    </Badge>
                  </span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
