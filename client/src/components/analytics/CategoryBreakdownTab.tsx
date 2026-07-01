import type { TrainingOverview } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell, PieChart as PieChartIcon } from "lucide-react";
import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "@/lib/api";
import { CATEGORY_COLORS } from "@/lib/categoryColors";
import { categoryLabels } from "@/lib/exerciseUtils";

import {
  type AnalysisMetric,
  buildBalanceAnalysis,
  CoverageAnalysisPanel,
  findPriorityGap,
  findTopCoverage,
  formatCount,
  formatPercent,
  getFreshnessLabel,
  hasCoverageWork,
  sumCoverageSets,
} from "./coverageAnalysis";
import { MuscleHeatMapCard } from "./MuscleHeatMapCard";

type MovementPatternCoverage = TrainingOverview["movementPatternCoverage"][number];

function getFreshnessColor(daysSince: number | null): string {
  if (daysSince === null) return "bg-muted/40 text-muted-foreground";
  if (daysSince <= 7) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (daysSince <= 14) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
}

interface CategoryBreakdownTabProps {
  readonly dateParams: string;
}

function CategoryTooltip({ active, payload }: Readonly<{ active?: boolean; payload?: Array<{ name: string; value: number; payload?: { fill: string } }> }>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-medium">{payload[0]?.name}</p>
      <p className="text-muted-foreground">{payload[0]?.value} sessions</p>
    </div>
  );
}

function buildMovementPatternAnalysis(patterns: readonly MovementPatternCoverage[]) {
  const trainedPatterns = patterns.filter(hasCoverageWork);
  const totalSets = patterns.reduce((sum, pattern) => sum + pattern.totalSets, 0);
  const topPattern = findTopCoverage(patterns);
  const priorityGap = findPriorityGap(patterns, "it has no logged sessions in this range");
  const coveragePercent = formatPercent(trainedPatterns.length, patterns.length);
  const balances = [
    buildBalanceAnalysis(
      "Push / Pull",
      "Push",
      sumCoverageSets(patterns, ["horizontal_push", "vertical_push"], (pattern) => pattern.pattern),
      "pull",
      sumCoverageSets(patterns, ["horizontal_pull", "vertical_pull"], (pattern) => pattern.pattern),
    ),
    buildBalanceAnalysis(
      "Squat+Lunge / Hinge",
      "Squat/lunge",
      sumCoverageSets(patterns, ["squat", "lunge_split_squat"], (pattern) => pattern.pattern),
      "hinge",
      sumCoverageSets(patterns, ["hinge"], (pattern) => pattern.pattern),
    ),
    buildBalanceAnalysis(
      "Core Flexion / Anti-rotation",
      "Core flexion",
      sumCoverageSets(patterns, ["core_flexion"], (pattern) => pattern.pattern),
      "anti-rotation",
      sumCoverageSets(patterns, ["core_anti_rotation"], (pattern) => pattern.pattern),
    ),
  ];
  const nextBalance = balances.find((balance) => balance.tone !== "good" && balance.recommendation);
  // ⚡ Bolt Performance Optimization:
  // Replaced O(N log N) array sorting (.sort()[0]) with an O(N) linear scan
  // to avoid unnecessary intermediate allocations and overhead when finding a single minimum.
  let leastLoaded: MovementPatternCoverage | null = null;
  for (const item of trainedPatterns) {
    if (!leastLoaded) {
      leastLoaded = item;
      continue;
    }
    const cmp = item.totalSets - leastLoaded.totalSets || item.label.localeCompare(leastLoaded.label);
    if (cmp < 0) {
      leastLoaded = item;
    }
  }

  const metrics: AnalysisMetric[] = [
    {
      label: "Coverage",
      value: `${trainedPatterns.length}/${patterns.length}`,
      detail: `${coveragePercent} of movement patterns trained in this range.`,
      tone: trainedPatterns.length === patterns.length ? "good" : "watch",
    },
    {
      label: "Strongest",
      value: topPattern?.label ?? "No loaded pattern",
      detail: topPattern
        ? `${formatCount(topPattern.totalSets, "set", "sets")} across ${formatCount(topPattern.sessionCount, "session", "sessions")}.`
        : "Log strength or functional sets to reveal the dominant pattern.",
      tone: topPattern ? "good" : "gap",
    },
    {
      label: "Gap",
      value: priorityGap?.item.label ?? "No stale gaps",
      detail: priorityGap?.reason ?? "Every trained movement pattern is inside the 14-day freshness window.",
      tone: priorityGap ? "gap" : "good",
    },
  ];

  const nextFocus = (() => {
    if (priorityGap) {
      return `Next focus: Add ${priorityGap.item.label}; ${priorityGap.reason}.`;
    }
    if (nextBalance?.recommendation) {
      return `Next focus: ${nextBalance.recommendation}`;
    }
    if (leastLoaded) {
      return `Next focus: Keep ${leastLoaded.label} in rotation; it is the lowest loaded trained pattern.`;
    }
    return "Next focus: Log a strength or functional movement so coverage analysis can start.";
  })();

  return { metrics, balances, nextFocus, totalSets };
}

function MovementPatternCoverageCard({
  patterns,
}: Readonly<{ patterns: TrainingOverview["movementPatternCoverage"] }>) {
  // ⚡ Bolt Performance Optimization:
  // Replaced O(N) intermediate array allocation and spread operator (.map(...))
  // with an O(N) linear scan to avoid memory overhead and potential stack limits.
  let maxSessionCount = 1;
  for (const pattern of patterns) {
    if (pattern.sessionCount > maxSessionCount) {
      maxSessionCount = pattern.sessionCount;
    }
  }
  const analysis = useMemo(() => buildMovementPatternAnalysis(patterns), [patterns]);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-base">Movement Pattern Coverage</CardTitle>
        <CardDescription>Session coverage, set volume, and recency by strength movement pattern</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CoverageAnalysisPanel
          balances={analysis.balances}
          balanceGridClassName="grid grid-cols-1 gap-3 lg:grid-cols-3"
          metricGridClassName="grid grid-cols-1 gap-3 md:grid-cols-3"
          metrics={analysis.metrics}
          nextFocus={analysis.nextFocus}
          nextFocusTestId="movement-pattern-next-focus"
          testId="movement-pattern-analysis"
          totalSets={analysis.totalSets}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3" data-testid="movement-pattern-coverage-grid">
          {patterns.map((pattern) => {
            const barWidth = pattern.sessionCount > 0
              ? Math.max(8, Math.round((pattern.sessionCount / maxSessionCount) * 100))
              : 0;
            return (
              <div key={pattern.pattern} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex min-h-10 items-start justify-between gap-2">
                  <p className="font-semibold leading-tight">{pattern.label}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${getFreshnessColor(pattern.daysSince)}`}>
                    {getFreshnessLabel(pattern.daysSince)}
                  </span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {formatCount(pattern.sessionCount, "session", "sessions")} - {formatCount(pattern.totalSets, "set", "sets")}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryBreakdownTab({ dateParams }: CategoryBreakdownTabProps) {
  const { data: overview, isLoading } = useQuery<TrainingOverview>({
    queryKey: ["/api/v1/training-overview", dateParams],
    queryFn: () => api.analytics.getTrainingOverview(dateParams),
  });

  const pieData = useMemo(() => {
    if (!overview) return [];
    const result = [];
    // ⚡ Bolt Performance Optimization:
    // Replaced chained `.filter(...).map(...)` with a single for...of loop.
    // This avoids an intermediate array allocation and a double O(N) traversal.
    for (const [cat, v] of Object.entries(overview.categoryTotals)) {
      if (v.count > 0) {
        result.push({
          name: categoryLabels[cat] ?? cat,
          value: v.count,
          fill: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other,
        });
      }
    }
    return result.sort((a, b) => b.value - a.value);
  }, [overview]);
  const movementPatternCoverage = overview?.movementPatternCoverage ?? [];
  const muscleGroupCoverage = overview?.muscleGroupCoverage ?? [];
  const hasMovementPatternData = movementPatternCoverage.some(
    (pattern) => pattern.sessionCount > 0 || pattern.totalSets > 0 || pattern.lastTrained !== null,
  );
  const hasMuscleHeatMapData = muscleGroupCoverage.some(
    (muscle) => muscle.sessionCount > 0 || muscle.totalSets > 0 || muscle.lastTrained !== null,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner iconClassName="h-6 w-6" />
      </div>
    );
  }

  if (
    !overview ||
    (
      pieData.length === 0 &&
      !hasMovementPatternData &&
      !hasMuscleHeatMapData
    )
  ) {
    return (
      <div className="flex items-center justify-center py-12 text-center bg-muted/20 rounded-lg border border-dashed">
        <div className="space-y-3">
          <PieChartIcon className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Your training mix and coverage insights appear here once you&apos;ve logged a handful of workouts across different categories.
          </p>
          <Button variant="outline" asChild>
            <Link href="/log" data-testid="button-log-workout-from-breakdown">
              <Dumbbell className="h-4 w-4 mr-2" />
              Log a Workout
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const categorySummary = pieData.map((slice) => `${slice.name} ${slice.value}`).join(", ");

  return (
    <div className="space-y-6">
      {/* Category Distribution */}
      {pieData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">Training Distribution</CardTitle>
            <CardDescription>Workout sessions by exercise category</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="h-[220px] w-full sm:h-[280px]"
              data-testid="chart-category-pie"
              role="img"
              aria-label={`Pie chart of training sessions by category: ${categorySummary}`}
            >
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

      <MuscleHeatMapCard muscles={muscleGroupCoverage} />

      <MovementPatternCoverageCard patterns={movementPatternCoverage} />
    </div>
  );
}
