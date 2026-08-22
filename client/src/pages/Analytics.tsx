import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import {
  BarChart3,
  CalendarCheck,
  Download,
  FileJson,
  FileSpreadsheet,
  HeartPulse,
  Loader2,
  PieChart,
  Sparkles,
  Target,
  Timer,
  Trophy,
  UtensilsCrossed,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

import { CategoryBreakdownTab } from "@/components/analytics/CategoryBreakdownTab";
import { CoachInsightsTab } from "@/components/analytics/CoachInsightsTab";
import { FuellingTab } from "@/components/analytics/FuellingTab";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { type AnalyticsExportFormat, api, QUERY_KEYS } from "@/lib/api";
import { featureFlags } from "@/lib/featureFlags";

type DateRange = "30" | "90" | "180" | "365" | "all";

const DATE_RANGES: readonly DateRange[] = ["30", "90", "180", "365", "all"];

// Literal classes (not interpolated) so Tailwind's JIT keeps them; the tab grid
// widens by one column per optional tab (MAF trend, Fuelling).
const SM_GRID_COLS: Record<number, string> = {
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
  7: "sm:grid-cols-7",
};

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
  const showFuelling = featureFlags.nutritionEnabled;
  // 5 base tabs + each optional tab. On mobile the tabs flow in a 2-col grid, so
  // the last tab is alone (and looks unbalanced) when the total is odd.
  const tabCount = 5 + (isMaf ? 1 : 0) + (showFuelling ? 1 : 0);
  const [dateRange, setDateRange] = useUrlQueryState<DateRange>("range", "90", DATE_RANGES);
  const [exportingFormat, setExportingFormat] = useState<AnalyticsExportFormat | null>(null);
  const isExporting = exportingFormat !== null;

  const dateParams = useMemo(() => {
    if (dateRange === "all") return "";
    // `subDays(today, N)` … today inclusive is N+1 days, so "Last 90 days"
    // fetched 91 (audit L10). N-1 makes the window exactly N days, and `to`
    // closes the top end rather than leaving it open — which also gives the
    // weekly rollup a real range to zero-fill rest weeks against (H7/M10).
    const today = new Date();
    const from = format(subDays(today, Number(dateRange) - 1), "yyyy-MM-dd");
    const to = format(today, "yyyy-MM-dd");
    return `?from=${from}&to=${to}`;
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
          <h1 className="text-2xl font-bold" data-testid="text-analytics-title">
            Analytics
          </h1>
          <p className="text-muted-foreground">
            Training overview, progression, and personal records
          </p>
          {preferences?.weeklyGoal ? (
            <Badge variant="outline" className="mt-2 gap-1.5" data-testid="badge-weekly-goal">
              <Target className="h-3 w-3" aria-hidden="true" />
              Weekly goal: {preferences.weeklyGoal} workout{preferences.weeklyGoal === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* A link rather than a tab: the review is scoped to one Monday-Sunday
              week while this page is scoped to the range picker beside it, and a
              fixed-window surface living inside a variable-window page is how you
              get "why do these two numbers disagree". */}
          <Button variant="outline" asChild data-testid="link-weekly-review">
            <Link href="/review">
              <CalendarCheck className="h-4 w-4 mr-2" aria-hidden="true" />
              Weekly review
            </Link>
          </Button>

          <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
            <SelectTrigger
              className="w-36"
              data-testid="select-date-range"
              aria-label="Analytics date range"
            >
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
        <TabsList
          className={`mb-6 grid h-auto w-full grid-cols-2 gap-1 sm:gap-0 ${SM_GRID_COLS[tabCount]}`}
        >
          <TabsTrigger value="overview" data-testid="tab-overview">
            <BarChart3 className="h-4 w-4 mr-2" aria-hidden="true" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="breakdown" data-testid="tab-breakdown">
            <PieChart className="h-4 w-4 mr-2" aria-hidden="true" />
            Breakdown
          </TabsTrigger>
          <TabsTrigger value="progress" data-testid="tab-progress">
            <Trophy className="h-4 w-4 mr-2" aria-hidden="true" />
            PRs &amp; Trends
          </TabsTrigger>
          <TabsTrigger value="insights" data-testid="tab-coach-insights">
            <Sparkles className="h-4 w-4 mr-2" aria-hidden="true" />
            Coach Insights
          </TabsTrigger>
          <TabsTrigger
            value="predictor"
            className={`${!isMaf && !showFuelling ? "col-span-2" : ""} sm:col-span-1`}
            data-testid="tab-race-predictor"
          >
            <Timer className="h-4 w-4 mr-2" aria-hidden="true" />
            Race Predictor
          </TabsTrigger>
          {isMaf ? (
            <TabsTrigger value="maf" data-testid="tab-maf-trend">
              <HeartPulse className="h-4 w-4 mr-2" aria-hidden="true" />
              MAF Trend
            </TabsTrigger>
          ) : null}
          {showFuelling ? (
            <TabsTrigger
              value="fuelling"
              className={`${tabCount % 2 === 1 ? "col-span-2" : ""} sm:col-span-1`}
              data-testid="tab-fuelling"
            >
              <UtensilsCrossed className="h-4 w-4 mr-2" aria-hidden="true" />
              Fuelling
            </TabsTrigger>
          ) : null}
        </TabsList>

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

        {showFuelling ? (
          <TabsContent value="fuelling" className="space-y-6">
            <FuellingTab dateParams={dateParams} />
          </TabsContent>
        ) : null}
      </Tabs>
    </PageContainer>
  );
}
