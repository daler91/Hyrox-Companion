import type { OverviewStats } from "@shared/schema";
import { BarChart3, Clock, Flame, ShieldCheck, Zap } from "lucide-react";

import { DeltaIndicator } from "../DeltaIndicator";

interface OverviewStatsGridProps {
  readonly stats: OverviewStats;
  readonly previousStats?: OverviewStats;
}

export function OverviewStatsGrid({ stats, previousStats }: OverviewStatsGridProps) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
          <BarChart3 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold" data-testid="text-avg-workouts">
                {stats.avgPerWeek}
              </p>
              {previousStats ? (
                <DeltaIndicator
                  current={stats.avgPerWeek}
                  previous={previousStats.avgPerWeek}
                  testIdSuffix="avg-workouts"
                />
              ) : null}
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Avg / Week
            </p>
          </div>
        </div>
        <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
          <Zap className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold" data-testid="text-total-workouts">
                {stats.totalWorkouts}
              </p>
              {previousStats ? (
                <DeltaIndicator
                  current={stats.totalWorkouts}
                  previous={previousStats.totalWorkouts}
                  testIdSuffix="total-workouts"
                />
              ) : null}
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Workouts
            </p>
          </div>
        </div>
        <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
          <Clock className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold" data-testid="text-avg-duration">
                {stats.avgDuration}
                <span className="text-sm font-normal text-muted-foreground">min</span>
              </p>
              {previousStats ? (
                <DeltaIndicator
                  current={stats.avgDuration}
                  previous={previousStats.avgDuration}
                  unit="min"
                  testIdSuffix="avg-duration"
                />
              ) : null}
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Avg Duration
            </p>
          </div>
        </div>
        <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
          <Flame className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold" data-testid="text-avg-rpe">
                {stats.avgRpe ?? "\u2014"}
              </p>
              {previousStats && stats.avgRpe !== null && previousStats.avgRpe !== null ? (
                <DeltaIndicator
                  current={stats.avgRpe}
                  previous={previousStats.avgRpe}
                  lowerIsBetter
                  testIdSuffix="avg-rpe"
                />
              ) : null}
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Avg RPE
            </p>
          </div>
        </div>
        <div className="bg-muted/50 p-4 rounded-lg flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold" data-testid="text-avg-adherence">
                {stats.avgCompliancePct ?? "\u2014"}
                {stats.avgCompliancePct != null && (
                  <span className="text-sm font-normal text-muted-foreground">%</span>
                )}
              </p>
              {previousStats &&
              stats.avgCompliancePct !== null &&
              previousStats.avgCompliancePct !== null ? (
                <DeltaIndicator
                  current={stats.avgCompliancePct}
                  previous={previousStats.avgCompliancePct}
                  unit="%"
                  testIdSuffix="avg-adherence"
                />
              ) : null}
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Avg Adherence
            </p>
          </div>
        </div>
      </div>
      {previousStats ? (
        <p className="text-xs text-muted-foreground -mt-2">
          Deltas compare the current period to the equivalent window immediately before it.
        </p>
      ) : null}
    </>
  );
}
