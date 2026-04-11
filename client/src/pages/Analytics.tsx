import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Activity, BarChart3, PieChart,Trophy } from "lucide-react";
import { useMemo } from "react";

import { CategoryBreakdownTab } from "@/components/analytics/CategoryBreakdownTab";
import { ExerciseProgressionTab } from "@/components/analytics/ExerciseProgressionTab";
import { PersonalRecordsTab } from "@/components/analytics/PersonalRecordsTab";
import { TrainingOverviewTab } from "@/components/analytics/TrainingOverviewTab";
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

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Analytics</h1>
          <p className="text-muted-foreground">Training overview, progression, and personal records</p>
        </div>

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
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <BarChart3 className="h-4 w-4 mr-2 hidden sm:block" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">
            <Activity className="h-4 w-4 mr-2 hidden sm:block" />
            Progression
          </TabsTrigger>
          <TabsTrigger value="prs" data-testid="tab-prs">
            <Trophy className="h-4 w-4 mr-2 hidden sm:block" />
            Records
          </TabsTrigger>
          <TabsTrigger value="breakdown" data-testid="tab-breakdown">
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
