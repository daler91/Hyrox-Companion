import { Activity, Calendar, Flame,Target, TrendingUp } from "lucide-react";

import { StatBadge } from "@/components/coach/StatBadge";

interface CoachPanelStatsProps {
  readonly stats: {
    workoutsThisWeek: number;
    completedThisWeek: number;
    plannedUpcoming: number;
    completionRate: number;
    currentStreak: number;
  };
}

export function CoachPanelStats({ stats }: Readonly<CoachPanelStatsProps>) {
  return (
    <section
      className="grid grid-cols-5 gap-1.5 p-2 border-b flex-shrink-0"
      aria-label="Training stats"
      data-testid="stats-bar"
    >
      <StatBadge icon={Activity} value={stats.workoutsThisWeek} label="Week" color="text-primary" ariaLabel={`${stats.workoutsThisWeek} workouts this week`} />
      <StatBadge icon={Target} value={stats.completedThisWeek} label="Done" color="text-green-500" ariaLabel={`${stats.completedThisWeek} completed this week`} />
      <StatBadge icon={Calendar} value={stats.plannedUpcoming} label="Next" color="text-blue-500" ariaLabel={`${stats.plannedUpcoming} upcoming planned`} />
      <StatBadge icon={TrendingUp} value={`${stats.completionRate}%`} label="Rate" color="text-orange-500" ariaLabel={`${stats.completionRate}% completion rate`} />
      <StatBadge icon={Flame} value={stats.currentStreak} label="Streak" color="text-red-500" ariaLabel={`${stats.currentStreak} day streak`} />
    </section>
  );
}
