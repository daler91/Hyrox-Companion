import { StatBadge } from "@/components/coach/StatBadge";
import { Activity, Target, Calendar, TrendingUp, Flame } from "lucide-react";

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
    <div className="grid grid-cols-5 gap-1.5 p-2 border-b flex-shrink-0" data-testid="stats-bar">
      <StatBadge icon={Activity} value={stats.workoutsThisWeek} label="Week" color="text-primary" />
      <StatBadge
        icon={Target}
        value={stats.completedThisWeek}
        label="Done"
        color="text-green-500"
      />
      <StatBadge icon={Calendar} value={stats.plannedUpcoming} label="Next" color="text-blue-500" />
      <StatBadge
        icon={TrendingUp}
        value={`${stats.completionRate}%`}
        label="Rate"
        color="text-orange-500"
      />
      <StatBadge icon={Flame} value={stats.currentStreak} label="Streak" color="text-red-500" />
    </div>
  );
}
