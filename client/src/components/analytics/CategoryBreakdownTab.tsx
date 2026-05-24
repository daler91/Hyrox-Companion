import type { TrainingOverview } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell, Loader2, PieChart as PieChartIcon } from "lucide-react";
import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { CATEGORY_COLORS } from "@/lib/categoryColors";
import { categoryLabels } from "@/lib/exerciseUtils";

import { MuscleHeatMapCard } from "./MuscleHeatMapCard";

type MovementPatternCoverage = TrainingOverview["movementPatternCoverage"][number];
type AnalysisTone = "good" | "watch" | "gap";
type AnalysisMetric = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: AnalysisTone;
};
type BalanceAnalysis = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: AnalysisTone;
  readonly recommendation: string | null;
};

const STALE_AFTER_DAYS = 14;
const BALANCE_RATIO_THRESHOLD = 1.6;

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

function CategoryTooltip({ active, payload }: Readonly<{ active?: boolean; payload?: Array<{ name: string; value: number; payload?: { fill: string } }> }>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-medium">{payload[0]?.name}</p>
      <p className="text-muted-foreground">{payload[0]?.value} sessions</p>
    </div>
  );
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function hasMovementWork(pattern: MovementPatternCoverage): boolean {
  return pattern.sessionCount > 0 || pattern.totalSets > 0 || pattern.lastTrained !== null;
}

function sumPatternSets(
  patterns: readonly MovementPatternCoverage[],
  patternNames: readonly string[],
): number {
  return patterns.reduce(
    (sum, pattern) => sum + (patternNames.includes(pattern.pattern) ? pattern.totalSets : 0),
    0,
  );
}

function getTopPattern(patterns: readonly MovementPatternCoverage[]): MovementPatternCoverage | null {
  return [...patterns]
    .filter(hasMovementWork)
    .sort((a, b) => (
      b.totalSets - a.totalSets ||
      b.sessionCount - a.sessionCount ||
      a.label.localeCompare(b.label)
    ))[0] ?? null;
}

function getMovementPriorityGap(patterns: readonly MovementPatternCoverage[]): {
  readonly pattern: MovementPatternCoverage;
  readonly reason: string;
} | null {
  const neverTrained = patterns.find((pattern) => !hasMovementWork(pattern) || pattern.daysSince === null);
  if (neverTrained) {
    return {
      pattern: neverTrained,
      reason: "it has no logged sessions in this range",
    };
  }

  const stale = [...patterns]
    .filter((pattern) => pattern.daysSince !== null && pattern.daysSince > STALE_AFTER_DAYS)
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))[0];
  if (!stale) return null;

  return {
    pattern: stale,
    reason: `last trained ${getFreshnessLabel(stale.daysSince).toLowerCase()}`,
  };
}

function buildBalanceAnalysis(
  label: string,
  leftLabel: string,
  leftSets: number,
  rightLabel: string,
  rightSets: number,
): BalanceAnalysis {
  const value = `${formatCount(leftSets, "set", "sets")} / ${formatCount(rightSets, "set", "sets")}`;
  const leftLower = leftLabel.toLowerCase();
  const rightLower = rightLabel.toLowerCase();

  if (leftSets === 0 && rightSets === 0) {
    return {
      label,
      value,
      detail: `No ${leftLower} or ${rightLower} volume logged.`,
      tone: "gap",
      recommendation: `Add ${leftLower} and ${rightLower} exposure before judging this balance.`,
    };
  }

  if (leftSets === 0) {
    return {
      label,
      value,
      detail: `Missing ${leftLower} volume.`,
      tone: "gap",
      recommendation: `Add ${leftLower} work to balance ${rightLower} volume.`,
    };
  }

  if (rightSets === 0) {
    return {
      label,
      value,
      detail: `${leftLabel} volume is leading ${rightLower} volume.`,
      tone: "gap",
      recommendation: `Add ${rightLower} work to balance ${leftLower} volume.`,
    };
  }

  const ratio = leftSets / rightSets;
  if (ratio >= BALANCE_RATIO_THRESHOLD) {
    return {
      label,
      value,
      detail: `${leftLabel} volume is leading ${rightLower} volume.`,
      tone: "watch",
      recommendation: `Add ${rightLower} work before more ${leftLower} volume.`,
    };
  }
  if (ratio <= 1 / BALANCE_RATIO_THRESHOLD) {
    return {
      label,
      value,
      detail: `${rightLabel} volume is leading ${leftLower} volume.`,
      tone: "watch",
      recommendation: `Add ${leftLower} work before more ${rightLower} volume.`,
    };
  }

  return {
    label,
    value,
    detail: `${leftLabel} and ${rightLower} volume are balanced.`,
    tone: "good",
    recommendation: null,
  };
}

function buildMovementPatternAnalysis(patterns: readonly MovementPatternCoverage[]) {
  const trainedPatterns = patterns.filter(hasMovementWork);
  const totalSets = patterns.reduce((sum, pattern) => sum + pattern.totalSets, 0);
  const topPattern = getTopPattern(patterns);
  const priorityGap = getMovementPriorityGap(patterns);
  const coveragePercent = formatPercent(trainedPatterns.length, patterns.length);
  const balances = [
    buildBalanceAnalysis(
      "Push / Pull",
      "Push",
      sumPatternSets(patterns, ["horizontal_push", "vertical_push"]),
      "pull",
      sumPatternSets(patterns, ["horizontal_pull", "vertical_pull"]),
    ),
    buildBalanceAnalysis(
      "Squat+Lunge / Hinge",
      "Squat/lunge",
      sumPatternSets(patterns, ["squat", "lunge_split_squat"]),
      "hinge",
      sumPatternSets(patterns, ["hinge"]),
    ),
    buildBalanceAnalysis(
      "Core Flexion / Anti-rotation",
      "Core flexion",
      sumPatternSets(patterns, ["core_flexion"]),
      "anti-rotation",
      sumPatternSets(patterns, ["core_anti_rotation"]),
    ),
  ];
  const nextBalance = balances.find((balance) => balance.tone !== "good" && balance.recommendation);
  const leastLoaded = [...trainedPatterns]
    .sort((a, b) => a.totalSets - b.totalSets || a.label.localeCompare(b.label))[0] ?? null;

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
      value: priorityGap?.pattern.label ?? "No stale gaps",
      detail: priorityGap?.reason ?? "Every trained movement pattern is inside the 14-day freshness window.",
      tone: priorityGap ? "gap" : "good",
    },
  ];

  const nextFocus = (() => {
    if (priorityGap) {
      return `Next focus: Add ${priorityGap.pattern.label}; ${priorityGap.reason}.`;
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

function getAnalysisToneClass(tone: AnalysisTone = "watch"): string {
  if (tone === "good") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "gap") {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function AnalysisMetricTile({ metric }: Readonly<{ metric: AnalysisMetric }>) {
  return (
    <div className={`rounded-md border p-3 ${getAnalysisToneClass(metric.tone)}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{metric.label}</p>
      <p className="mt-1 text-sm font-semibold leading-tight text-foreground">{metric.value}</p>
      <p className="mt-1 text-xs leading-snug opacity-90">{metric.detail}</p>
    </div>
  );
}

function BalanceTile({ balance }: Readonly<{ balance: BalanceAnalysis }>) {
  return (
    <div className={`rounded-md border p-3 ${getAnalysisToneClass(balance.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide opacity-80">{balance.label}</p>
        <p className="shrink-0 text-xs font-semibold text-foreground">{balance.value}</p>
      </div>
      <p className="mt-2 text-xs leading-snug opacity-90">{balance.detail}</p>
    </div>
  );
}

function MovementPatternCoverageCard({
  patterns,
}: Readonly<{ patterns: TrainingOverview["movementPatternCoverage"] }>) {
  const maxSessionCount = Math.max(1, ...patterns.map((pattern) => pattern.sessionCount));
  const analysis = useMemo(() => buildMovementPatternAnalysis(patterns), [patterns]);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-base">Movement Pattern Coverage</CardTitle>
        <CardDescription>Session coverage, set volume, and recency by strength movement pattern</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3" data-testid="movement-pattern-analysis">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {analysis.metrics.map((metric) => (
              <AnalysisMetricTile key={metric.label} metric={metric} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {analysis.balances.map((balance) => (
              <BalanceTile key={balance.label} balance={balance} />
            ))}
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid="movement-pattern-next-focus">
            <span className="font-semibold">{formatCount(analysis.totalSets, "mapped set", "mapped sets")} analyzed. </span>
            <span className="text-muted-foreground">{analysis.nextFocus}</span>
          </div>
        </div>
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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (
    !overview ||
    (
      pieData.length === 0 &&
      overview.stationCoverage.every((s) => s.lastTrained === null) &&
      !hasMovementPatternData &&
      !hasMuscleHeatMapData
    )
  ) {
    return (
      <div className="flex items-center justify-center py-12 text-center bg-muted/20 rounded-lg border border-dashed">
        <div className="space-y-3">
          <PieChartIcon className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Your training mix and station coverage appear here once you&apos;ve logged a handful of workouts across different categories.
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

      {/* Functional Station Coverage */}
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Functional Station Coverage</CardTitle>
          <CardDescription>Track when you last trained each functional station (incl. hyrox stations)</CardDescription>
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

      <MuscleHeatMapCard muscles={muscleGroupCoverage} />

      <MovementPatternCoverageCard patterns={movementPatternCoverage} />
    </div>
  );
}
