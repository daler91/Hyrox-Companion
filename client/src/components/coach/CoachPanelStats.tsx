import { Activity, Calendar, Flame,Target, TrendingUp } from "lucide-react";

import { StatBadge } from "@/components/coach/StatBadge";
import { COMPLETION_RATE_WINDOW_DAYS } from "@/lib/statsUtils";

const RATE_WINDOW_WEEKS = COMPLETION_RATE_WINDOW_DAYS / 7;

interface CoachPanelStatsProps {
  readonly stats: {
    workoutsThisWeek: number;
    completedThisWeek: number;
    plannedUpcoming: number;
    completionRate: number | null;
    currentStreak: number;
  };
}

/**
 * The week, done, next and rate counts are calculateStats over the timeline as
 * loaded, under its plan filter, so their labels say so rather than calling the
 * rate all-time. The rate covers the last 4 weeks, and its visible label says
 * that too. The streak is the server's. CL59 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function CoachPanelStats({ stats }: Readonly<CoachPanelStatsProps>) {
  return (
    <section
      className="grid grid-cols-5 gap-1.5 p-2 border-b flex-shrink-0"
      aria-label="Training stats"
      data-testid="stats-bar"
    >
      <StatBadge icon={Activity} value={stats.workoutsThisWeek} label="Week" color="text-primary" ariaLabel={`${stats.workoutsThisWeek} workouts this week on the timeline shown`} />
      <StatBadge icon={Target} value={stats.completedThisWeek} label="Done" color="text-green-500" ariaLabel={`${stats.completedThisWeek} completed this week on the timeline shown`} />
      <StatBadge icon={Calendar} value={stats.plannedUpcoming} label="Next" color="text-blue-500" ariaLabel={`${stats.plannedUpcoming} upcoming planned on the timeline shown`} />
      <StatBadge
        icon={TrendingUp}
        // An em dash rather than "0%" when nothing has come due in the window:
        // a new athlete has no completion rate, and 0% reads as total failure
        // (audit M5).
        value={stats.completionRate == null ? "\u2014" : `${stats.completionRate}%`}
        label={`${RATE_WINDOW_WEEKS}wk rate`}
        color="text-orange-500"
        ariaLabel={
          stats.completionRate == null
            ? `No completion rate: nothing came due in the last ${RATE_WINDOW_WEEKS} weeks on the timeline shown`
            : `${stats.completionRate}% completion rate over the last ${RATE_WINDOW_WEEKS} weeks on the timeline shown`
        }
      />
      <StatBadge icon={Flame} value={stats.currentStreak} label="Streak" color="text-red-500" ariaLabel={`${stats.currentStreak} day streak`} />
    </section>
  );
}
