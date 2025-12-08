import { MetricCard } from "../MetricCard";
import { Activity, Clock, Trophy } from "lucide-react";

export default function MetricCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
      <MetricCard
        title="Workouts This Week"
        value={5}
        trend="up"
        trendValue="+2 vs last week"
        icon={Activity}
      />
      <MetricCard
        title="Training Hours"
        value="8.5"
        unit="hrs"
        trend="up"
        trendValue="+1.2 hrs"
        icon={Clock}
      />
      <MetricCard
        title="Personal Bests"
        value={3}
        trend="neutral"
        trendValue="Same as last month"
        icon={Trophy}
      />
    </div>
  );
}
