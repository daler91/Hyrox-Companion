import type { WeeklyReview } from "@shared/schema";
import { CalendarCheck, Clock, Gauge, Trophy } from "lucide-react";

import { DeltaIndicator } from "@/components/analytics/DeltaIndicator";
import { Card, CardContent } from "@/components/ui/card";

interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly icon: typeof Clock;
  readonly testId: string;
  readonly delta?: React.ReactNode;
}

function Stat({ label, value, sub, icon: Icon, testId, delta }: StatProps) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta}
        </div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The week's headline numbers.
 *
 * Sessions logged and plan adherence are deliberately two separate tiles, not
 * one completion rate: the counts come from different tables, so an athlete who
 * trains off-plan can log more sessions than they scheduled, and a single rate
 * over both sources reads as an impossible >100%. The adherence tile is
 * suppressed entirely for an athlete with no plan that week, where "0 of 0"
 * would be a verdict on a plan they never had.
 */
export function WeeklyReviewSummary({ review }: { readonly review: WeeklyReview }) {
  const { current, previous, weeklyGoal, hasPlan, isCurrentWeek } = review;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        testId="weekly-review-sessions"
        label={isCurrentWeek ? "Sessions so far" : "Sessions"}
        icon={CalendarCheck}
        value={String(current.sessionsLogged)}
        sub={`Goal ${weeklyGoal}/week`}
        delta={
          <DeltaIndicator
            current={current.sessionsLogged}
            previous={previous.sessionsLogged}
            testIdSuffix="sessions"
          />
        }
      />

      {hasPlan && (
        <Stat
          testId="weekly-review-adherence"
          label="Plan"
          icon={Gauge}
          value={`${current.plannedCompleted}/${current.sessionsPlanned}`}
          sub={[
            current.missed > 0 ? `${current.missed} missed` : null,
            current.skipped > 0 ? `${current.skipped} skipped` : null,
            // Same wording as the timeline's badge for these days. Deliberately
            // its own phrase, never folded into "missed" — the split is the point.
            current.excused > 0 ? `${current.excused} not counted` : null,
            current.outstanding > 0 ? `${current.outstanding} to go` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "All sessions done"}
        />
      )}

      <Stat
        testId="weekly-review-duration"
        label="Time"
        icon={Clock}
        value={formatDuration(current.totalDurationMin)}
        delta={
          <DeltaIndicator
            current={current.totalDurationMin}
            previous={previous.totalDurationMin}
            unit="m"
            testIdSuffix="duration"
          />
        }
      />

      <Stat
        testId="weekly-review-rpe"
        label="Avg RPE"
        icon={Trophy}
        value={current.avgRpe === null ? "—" : current.avgRpe.toFixed(1)}
        sub={current.avgRpe === null ? "No effort logged" : undefined}
        delta={
          // Only compare when both weeks have effort data — a delta against a
          // week with no RPE at all would read as a collapse rather than as
          // missing data.
          current.avgRpe !== null && previous.avgRpe !== null ? (
            <DeltaIndicator
              current={current.avgRpe}
              previous={previous.avgRpe}
              testIdSuffix="rpe"
            />
          ) : undefined
        }
      />
    </div>
  );
}
