import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { BarChart3, Download, FileJson, FileSpreadsheet, HeartPulse, Loader2, PieChart, Sparkles, Target, Timer, Trophy } from "lucide-react";
import { useMemo, useState } from "react";

import { CategoryBreakdownTab } from "@/components/analytics/CategoryBreakdownTab";
import { CoachInsightsTab } from "@/components/analytics/CoachInsightsTab";
import { MafTrendTab } from "@/components/analytics/MafTrendTab";
import { ProgressTab } from "@/components/analytics/ProgressTab";
import { RacePredictorTab } from "@/components/analytics/RacePredictorTab";
import { TrainingOverviewTab } from "@/components/analytics/TrainingOverviewTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContainer } from "@/components/ui/PageContainer";
import { ScrollableTabsList } from "@/components/ui/scrollable-tabs-list";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { type AnalyticsExportFormat, api, QUERY_KEYS } from "@/lib/api";

type DateRange = "30" | "90" | "180" | "365" | "all";

const DATE_RANGES: readonly DateRange[] = ["30", "90", "180", "365", "all"];

function getExportFilename(response: Response, exportFormat: AnalyticsExportFormat) {
  const contentDisposition = response.headers.get("Content-Disposition");
  const filenameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] ?? `hyrox-training-data.${exportFormat}`;
}

export default function Analytics() {
  useDocumentTitle("Analytics");
  const { toast } = useToast();
  const { user } = useAuth();
  const isMaf = user?.trainingStyleId === "maf_method";
  const [dateRange, setDateRange] = useUrlQueryState<DateRange>(
    "range",
    "90",
    DATE_RANGES,
  );
  const [exportingFormat, setExportingFormat] = useState<AnalyticsExportFormat | null>(null);
  const isExporting = exportingFormat !== null;

  const dateParams = useMemo(() => {
    if (dateRange === "all") return "";
    const from = format(subDays(new Date(), Number(dateRange)), "yyyy-MM-dd");
    return `?from=${from}`;
  }, [dateRange]);

  const { data: preferences } = useQuery<{ weeklyGoal?: number }>({
    queryKey: QUERY_KEYS.preferences,
  });

  const handleExport = async (exportFormat: AnalyticsExportFormat) => {
    setExportingFormat(exportFormat);
    try {
      const response = await api.analytics.exportData(exportFormat);
      const blob = await response.blob();
      const downloadUrl = globalThis.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getExportFilename(response, exportFormat);
      document.body.append(link);
      link.click();
      link.remove();
      globalThis.URL.revokeObjectURL(downloadUrl);
    } catch {
      toast({
        title: "Export failed",
        description: "Could not download your training data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <PageContainer size="default" className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Analytics</h1>
          <p className="text-muted-foreground">Training overview, progression, and personal records</p>
          {preferences?.weeklyGoal ? (
            <Badge
              variant="outline"
              className="mt-2 gap-1.5"
              data-testid="badge-weekly-goal"
            >
              <Target className="h-3 w-3" aria-hidden="true" />
              Weekly goal: {preferences.weeklyGoal} workout{preferences.weeklyGoal === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
            <SelectTrigger className="w-36" data-testid="select-date-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                data-testid="button-analytics-export"
                disabled={isExporting}
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                )}
                {isExporting ? "Exporting..." : "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleExport("csv")}
                data-testid="button-export-analytics-csv"
                disabled={isExporting}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" aria-hidden="true" />
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExport("json")}
                data-testid="button-export-analytics-json"
                disabled={isExporting}
              >
                <FileJson className="h-4 w-4 mr-2" aria-hidden="true" />
                Export as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <ScrollableTabsList className={`flex h-auto w-full gap-1 snap-x overflow-x-auto scrollbar-none justify-start sm:grid sm:gap-0 sm:overflow-visible ${isMaf ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
          <TabsTrigger value="overview" className="shrink-0 snap-start scroll-mx-1 sm:shrink" data-testid="tab-overview">
            <BarChart3 className="h-4 w-4 mr-2 hidden sm:block" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="breakdown" className="shrink-0 snap-start scroll-mx-1 sm:shrink" data-testid="tab-breakdown">
            <PieChart className="h-4 w-4 mr-2 hidden sm:block" />
            Breakdown
          </TabsTrigger>
          <TabsTrigger value="progress" className="shrink-0 snap-start scroll-mx-1 sm:shrink" data-testid="tab-progress">
            <Trophy className="h-4 w-4 mr-2 hidden sm:block" />
            PRs &amp; Trends
          </TabsTrigger>
          <TabsTrigger value="insights" className="shrink-0 snap-start scroll-mx-1 sm:shrink" data-testid="tab-coach-insights">
            <Sparkles className="h-4 w-4 mr-2 hidden sm:block" />
            Coach Insights
          </TabsTrigger>
          <TabsTrigger value="predictor" className="shrink-0 snap-start scroll-mx-1 sm:shrink" data-testid="tab-race-predictor">
            <Timer className="h-4 w-4 mr-2 hidden sm:block" />
            Race Predictor
          </TabsTrigger>
          {isMaf ? (
            <TabsTrigger value="maf" className="shrink-0 snap-start scroll-mx-1 sm:shrink" data-testid="tab-maf-trend">
              <HeartPulse className="h-4 w-4 mr-2 hidden sm:block" />
              MAF Trend
            </TabsTrigger>
          ) : null}
        </ScrollableTabsList>

        <TabsContent value="overview" className="space-y-6">
          <TrainingOverviewTab dateParams={dateParams} weeklyGoal={preferences?.weeklyGoal} />
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-6">
          <CategoryBreakdownTab dateParams={dateParams} />
        </TabsContent>

        <TabsContent value="progress" className="space-y-6">
          <ProgressTab dateParams={dateParams} />
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <CoachInsightsTab />
        </TabsContent>

        <TabsContent value="predictor" className="space-y-6">
          <RacePredictorTab />
        </TabsContent>

        {isMaf ? (
          <TabsContent value="maf" className="space-y-6">
            <MafTrendTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </PageContainer>
  );
}
