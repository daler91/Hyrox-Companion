import { useState, useMemo } from "react";
import { format, subDays } from "date-fns";
import { Activity, Trophy } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonalRecordsTab } from "@/components/analytics/PersonalRecordsTab";
import { ExerciseProgressionTab } from "@/components/analytics/ExerciseProgressionTab";

export default function Analytics() {
  const [dateRange, setDateRange] = useState<string>("90");

  const dateParams = useMemo(() => {
    if (dateRange === "all") return "";
    const from = format(subDays(new Date(), Number(dateRange)), "yyyy-MM-dd");
    return `?from=${from}`;
  }, [dateRange]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Analytics</h1>
          <p className="text-muted-foreground">Personal records and exercise progression</p>
        </div>

        <Select value={dateRange} onValueChange={setDateRange}>
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

      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="trends" data-testid="tab-trends">
            <Activity className="h-4 w-4 mr-2" />
            Trends & Progression
          </TabsTrigger>
          <TabsTrigger value="prs" data-testid="tab-prs">
            <Trophy className="h-4 w-4 mr-2" />
            Personal Records
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prs" className="space-y-6">
          <PersonalRecordsTab dateParams={dateParams} />
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <ExerciseProgressionTab dateParams={dateParams} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
