import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PieChart as PieChartIcon } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { TrainingOverview } from "@shared/schema";
import { categoryLabels } from "@/lib/exerciseUtils";

const CATEGORY_COLORS: Record<string, string> = {
  functional: "#f97316",
  running: "#3b82f6",
  strength: "#a855f7",
  conditioning: "#ef4444",
  other: "#64748b",
};

const STATION_LABELS: Record<string, string> = {
  skierg: "SkiErg",
  sled_push: "Sled Push",
  sled_pull: "Sled Pull",
  burpee_broad_jump: "Burpee Broad Jump",
  rowing: "Rowing",
  farmers_carry: "Farmers Carry",
  sandbag_lunges: "Sandbag Lunges",
  wall_balls: "Wall Balls",
  running: "Running",
};

function getFreshnessColor(daysSince: number | null): string {
  if (daysSince === null) return "bg-muted/40 text-muted-foreground";
  if (daysSince <= 7) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (daysSince <= 14) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
}

function getFreshnessLabel(daysSince: number | null): string {
  if (daysSince === null) return "Never trained";
  if (daysSince === 0) return "Today";
  if (daysSince === 1) return "Yesterday";
  return `${daysSince}d ago`;
}

interface CategoryBreakdownTabProps {
  readonly dateParams: string;
}

function CategoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload?: { fill: string } }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-medium">{payload[0]?.name}</p>
      <p className="text-muted-foreground">{payload[0]?.value} sessions</p>
    </div>
  );
}

export function CategoryBreakdownTab({ dateParams }: CategoryBreakdownTabProps) {
  const { data: overview, isLoading } = useQuery<TrainingOverview>({
    queryKey: ["/api/v1/training-overview", dateParams],
    queryFn: () => api.analytics.getTrainingOverview(dateParams),
  });

  const pieData = useMemo(() => {
    if (!overview) return [];
    return Object.entries(overview.categoryTotals)
      .filter(([, v]) => v.count > 0)
      .map(([cat, v]) => ({
        name: categoryLabels[cat] ?? cat,
        value: v.count,
        fill: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other,
      }))
      .sort((a, b) => b.value - a.value);
  }, [overview]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!overview || (pieData.length === 0 && overview.stationCoverage.every((s) => s.lastTrained === null))) {
    return (
      <div className="flex items-center justify-center py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
        <div>
          <PieChartIcon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p>No exercise data yet. Log workouts to see your training breakdown.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Category Distribution */}
      {pieData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Training Distribution</CardTitle>
            <CardDescription>Workout sessions by exercise category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full" data-testid="chart-category-pie">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<CategoryTooltip />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hyrox Station Coverage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hyrox Station Coverage</CardTitle>
          <CardDescription>Track when you last trained each Hyrox station</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3" data-testid="station-coverage-grid">
            {overview.stationCoverage.map((station) => (
              <div
                key={station.station}
                className={`p-3 rounded-lg border text-sm ${getFreshnessColor(station.daysSince)}`}
              >
                <p className="font-semibold">
                  {STATION_LABELS[station.station] ?? station.station}
                </p>
                <p className="text-xs mt-1 opacity-80">
                  {getFreshnessLabel(station.daysSince)}
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-green-500/30 border border-green-500/30" />
              <span>&le; 7 days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-amber-500/30 border border-amber-500/30" />
              <span>8-14 days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-red-500/30 border border-red-500/30" />
              <span>14+ days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-muted/40" />
              <span>Never</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
