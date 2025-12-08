import { WeeklySummary } from "../WeeklySummary";

export default function WeeklySummaryExample() {
  const mockDays = [
    { day: "Mon", volume: 60, maxVolume: 90 },
    { day: "Tue", volume: 0, maxVolume: 90 },
    { day: "Wed", volume: 45, maxVolume: 90 },
    { day: "Thu", volume: 75, maxVolume: 90 },
    { day: "Fri", volume: 0, maxVolume: 90 },
    { day: "Sat", volume: 90, maxVolume: 90 },
    { day: "Sun", volume: 30, maxVolume: 90 },
  ];

  return (
    <div className="p-4 max-w-xl">
      <WeeklySummary
        days={mockDays}
        totalWorkouts={5}
        totalHours={5.0}
        totalDistance={18500}
      />
    </div>
  );
}
