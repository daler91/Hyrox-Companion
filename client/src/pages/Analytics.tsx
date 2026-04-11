import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Activity, BarChart3, Download, FileJson, FileSpreadsheet, PieChart, Target,Trophy } from "lucide-react";
import { useMemo } from "react";

import { CategoryBreakdownTab } from "@/components/analytics/CategoryBreakdownTab";
import { ExerciseProgressionTab } from "@/components/analytics/ExerciseProgressionTab";
import { PersonalRecordsTab } from "@/components/analytics/PersonalRecordsTab";
import { TrainingOverviewTab } from "@/components/analytics/TrainingOverviewTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { QUERY_KEYS } from "@/lib/api";

type DateRange = "30" | "90" | "180" | "365" | "all";

const DATE_RANGES: readonly DateRange[] = ["30", "90", "180", "365", "all"];

export default function Analytics() {
  const [dateRange, setDateRange] = useUrlQueryState<DateRange>(
    "range",
    "90",
    DATE_RANGES,
  );

  const dateParams = useMemo(() => {
    if (dateRange === "all") return "";
    const from = format(subDays(new Date(), Number(dateRange)), "yyyy-MM-dd");
    return `?from=${from}`;
  }, [dateRange]);

  const { data: preferences } = useQuery<{ weeklyGoal?: number }>({
    queryKey: QUERY_KEYS.preferences,
  });

  const handleExport = (exportFormat: "csv" | "json") => {
    globalThis.location.href = `/api/v1/export?format=${exportFormat}`;
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
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
              <Button variant="outline" data-testid="button-analytics-export">
                <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleExport("csv")}
                data-testid="button-export-analytics-csv"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" aria-hidden="true" />
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExport("json")}
                data-testid="button-export-analytics-json"
              >
                <FileJson className="h-4 w-4 mr-2" aria-hidden="true" />
                Export as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6 flex h-auto w-full gap-1 overflow-x-auto scrollbar-none justify-start sm:grid sm:grid-cols-4 sm:gap-0 sm:overflow-visible">
          <TabsTrigger value="overview" className="shrink-0 sm:shrink" data-testid="tab-overview">
            <BarChart3 className="h-4 w-4 mr-2 hidden sm:block" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="trends" className="shrink-0 sm:shrink" data-testid="tab-trends">
            <Activity className="h-4 w-4 mr-2 hidden sm:block" />
            Progression
          </TabsTrigger>
          <TabsTrigger value="prs" className="shrink-0 sm:shrink" data-testid="tab-prs">
            <Trophy className="h-4 w-4 mr-2 hidden sm:block" />
            Records
          </TabsTrigger>
          <TabsTrigger value="breakdown" className="shrink-0 sm:shrink" data-testid="tab-breakdown">
            <PieChart className="h-4 w-4 mr-2 hidden sm:block" />
            Breakdown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <TrainingOverviewTab dateParams={dateParams} weeklyGoal={preferences?.weeklyGoal} />
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <ExerciseProgressionTab dateParams={dateParams} />
        </TabsContent>

        <TabsContent value="prs" className="space-y-6">
          <PersonalRecordsTab dateParams={dateParams} />
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-6">
          <CategoryBreakdownTab dateParams={dateParams} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
