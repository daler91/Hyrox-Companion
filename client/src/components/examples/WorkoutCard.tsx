import { WorkoutCard } from "../WorkoutCard";

export default function WorkoutCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 max-w-4xl">
      <WorkoutCard
        id="1"
        date="Dec 8, 2024"
        title="Full Hyrox Simulation"
        duration={75}
        exercises={["running", "skierg", "sled_push", "sled_pull", "burpees", "rowing", "farmers_carry", "wall_balls"]}
        notes="Focused on pacing. Felt strong on SkiErg."
        onEdit={(id) => console.log("Edit", id)}
        onDelete={(id) => console.log("Delete", id)}
        onDuplicate={(id) => console.log("Duplicate", id)}
      />
      <WorkoutCard
        id="2"
        date="Dec 7, 2024"
        title="Running Intervals"
        duration={45}
        exercises={["running"]}
        onEdit={(id) => console.log("Edit", id)}
        onDelete={(id) => console.log("Delete", id)}
        onDuplicate={(id) => console.log("Duplicate", id)}
      />
    </div>
  );
}
