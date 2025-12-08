import { MetricCard } from "@/components/MetricCard";
import { WorkoutCard } from "@/components/WorkoutCard";
import { WeeklySummary } from "@/components/WeeklySummary";
import { Button } from "@/components/ui/button";
import { Activity, Clock, Trophy, Plus, MessageSquare } from "lucide-react";
import { Link } from "wouter";
import type { ExerciseType } from "@/components/WorkoutCard";

interface Workout {
  id: string;
  date: string;
  title: string;
  duration: number;
  exercises: ExerciseType[];
  notes?: string;
}

export default function Dashboard() {
  // todo: remove mock functionality
  const mockWorkouts: Workout[] = [
    {
      id: "1",
      date: "Dec 8, 2024",
      title: "Full Hyrox Simulation",
      duration: 75,
      exercises: ["running", "skierg", "sled_push", "sled_pull", "burpees", "rowing", "farmers_carry", "wall_balls"],
      notes: "Good pacing throughout. Need to work on transitions.",
    },
    {
      id: "2",
      date: "Dec 7, 2024",
      title: "Running + SkiErg Focus",
      duration: 50,
      exercises: ["running", "skierg"],
    },
    {
      id: "3",
      date: "Dec 5, 2024",
      title: "Strength Circuit",
      duration: 45,
      exercises: ["sled_push", "sled_pull", "farmers_carry", "wall_balls"],
      notes: "Increased sled weight to 25kg.",
    },
    {
      id: "4",
      date: "Dec 4, 2024",
      title: "Interval Training",
      duration: 35,
      exercises: ["running", "burpees", "rowing"],
    },
  ];

  const mockDays = [
    { day: "Mon", volume: 60, maxVolume: 90 },
    { day: "Tue", volume: 0, maxVolume: 90 },
    { day: "Wed", volume: 45, maxVolume: 90 },
    { day: "Thu", volume: 75, maxVolume: 90 },
    { day: "Fri", volume: 0, maxVolume: 90 },
    { day: "Sat", volume: 90, maxVolume: 90 },
    { day: "Sun", volume: 30, maxVolume: 90 },
  ];

  const handleEdit = (id: string) => {
    console.log("Edit workout:", id);
  };

  const handleDelete = (id: string) => {
    console.log("Delete workout:", id);
  };

  const handleDuplicate = (id: string) => {
    console.log("Duplicate workout:", id);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-greeting">
            Welcome back
          </h1>
          <p className="text-muted-foreground mt-1">
            Week of December 2 - December 8, 2024
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild data-testid="button-log-workout">
            <Link href="/log">
              <Plus className="h-4 w-4 mr-2" />
              Log Workout
            </Link>
          </Button>
          <Button variant="outline" asChild data-testid="button-chat">
            <Link href="/chat">
              <MessageSquare className="h-4 w-4 mr-2" />
              AI Coach
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Workouts This Week"
          value={5}
          trend="up"
          trendValue="+2 vs last week"
          icon={Activity}
        />
        <MetricCard
          title="Training Hours"
          value="5.0"
          unit="hrs"
          trend="up"
          trendValue="+1.5 hrs"
          icon={Clock}
        />
        <MetricCard
          title="Personal Bests"
          value={2}
          trend="up"
          trendValue="This month"
          icon={Trophy}
        />
      </div>

      <WeeklySummary
        days={mockDays}
        totalWorkouts={5}
        totalHours={5.0}
        totalDistance={18500}
      />

      <div>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-semibold">Recent Workouts</h2>
          <Button variant="ghost" asChild data-testid="link-view-all">
            <Link href="/history">View all</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mockWorkouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              {...workout}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
