import { useQuery } from "@tanstack/react-query";
import { Activity, HeartPulse } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api, type MafTestsListResponse, QUERY_KEYS } from "@/lib/api";

import { buildComplianceTrendData, buildTestRows, classificationMeta } from "./mafTrend.helpers";
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
  const { data, isLoading } = useQuery<MafTestsListResponse>({
    queryKey: QUERY_KEYS.mafTests,
    queryFn: () => api.mafTests.list(),
  });

  if (isLoading) return <LoadingSpinner />;

  const rows = buildTestRows(data);
  if (rows.length === 0) return <EmptyState />;

  const trend = buildComplianceTrendData(data?.analysis ?? []);
  const latest = rows[0];
  const latestMeta = classificationMeta(latest.classification);

  return (
    <div className="space-y-6" data-testid="maf-trend-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5" data-testid="maf-trend-count">
          <Activity className="h-3 w-3" aria-hidden="true" />
          {rows.length} MAF test{rows.length === 1 ? "" : "s"}
        </Badge>
        {latest.compliancePct != null ? (
          <Badge variant="outline" className={`gap-1.5 ${TONE_BADGE_CLASS[latestMeta.tone]}`} data-testid="maf-trend-latest">
            Latest: {latest.compliancePct}% · {latestMeta.label}
          </Badge>
        ) : null}
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test history</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((row) => {
            const meta = classificationMeta(row.classification);
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                data-testid={`maf-test-row-${row.id}`}
              >
                <span className="text-sm font-medium">{formatTestDate(row.date)}</span>
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
