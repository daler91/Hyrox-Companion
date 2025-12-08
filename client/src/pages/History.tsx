import { useState } from "react";
import { WorkoutCard } from "@/components/WorkoutCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Filter, Calendar, Clock, Flame } from "lucide-react";
import type { ExerciseType } from "@/components/WorkoutCard";

interface Workout {
  id: string;
  date: string;
  title: string;
  duration: number;
  exercises: ExerciseType[];
  notes?: string;
}

export default function History() {
  const [searchQuery, setSearchQuery] = useState("");
  const [exerciseFilter, setExerciseFilter] = useState<string>("all");

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
    {
      id: "5",
      date: "Dec 2, 2024",
      title: "Easy Recovery Run",
      duration: 30,
      exercises: ["running"],
      notes: "Light pace, focusing on form.",
    },
    {
      id: "6",
      date: "Dec 1, 2024",
      title: "Full Hyrox Practice",
      duration: 80,
      exercises: ["running", "skierg", "sled_push", "sled_pull", "burpees", "rowing", "farmers_carry", "wall_balls"],
    },
  ];

  const filteredWorkouts = mockWorkouts.filter((workout) => {
    const matchesSearch = workout.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workout.notes?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = exerciseFilter === "all" || workout.exercises.includes(exerciseFilter as ExerciseType);
    return matchesSearch && matchesFilter;
  });

  const totalWorkouts = mockWorkouts.length;
  const totalHours = mockWorkouts.reduce((acc, w) => acc + w.duration, 0) / 60;
  const totalExercises = mockWorkouts.reduce((acc, w) => acc + w.exercises.length, 0);

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
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workout History</h1>
        <p className="text-muted-foreground mt-1">
          View and manage all your training sessions
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-1">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">Total Workouts</span>
              </div>
              <p className="text-2xl font-mono font-bold" data-testid="text-total-workouts">
                {totalWorkouts}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-sm">Training Hours</span>
              </div>
              <p className="text-2xl font-mono font-bold" data-testid="text-total-hours">
                {totalHours.toFixed(1)}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-1">
                <Flame className="h-4 w-4" />
                <span className="text-sm">Exercises Done</span>
              </div>
              <p className="text-2xl font-mono font-bold" data-testid="text-total-exercises">
                {totalExercises}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workouts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
        <Select value={exerciseFilter} onValueChange={setExerciseFilter}>
          <SelectTrigger className="w-full sm:w-48" data-testid="select-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter by exercise" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Exercises</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="skierg">SkiErg</SelectItem>
            <SelectItem value="sled_push">Sled Push</SelectItem>
            <SelectItem value="sled_pull">Sled Pull</SelectItem>
            <SelectItem value="burpees">Burpees</SelectItem>
            <SelectItem value="rowing">Rowing</SelectItem>
            <SelectItem value="farmers_carry">Farmers Carry</SelectItem>
            <SelectItem value="wall_balls">Wall Balls</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredWorkouts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              No workouts found matching your criteria.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => {
              setSearchQuery("");
              setExerciseFilter("all");
            }} data-testid="button-clear-filters">
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredWorkouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              {...workout}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
