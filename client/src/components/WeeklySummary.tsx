import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DayData {
  day: string;
  volume: number;
  maxVolume: number;
}

interface WeeklySummaryProps {
  days: DayData[];
  totalWorkouts: number;
  totalHours: number;
  totalDistance: number;
}

export function WeeklySummary({ days, totalWorkouts, totalHours, totalDistance }: WeeklySummaryProps) {
  return (
    <Card data-testid="card-weekly-summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">This Week</CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        <div className="flex items-end justify-between gap-2 h-24 mb-4">
          {days.map((day, index) => {
            const heightPercent = day.maxVolume > 0 ? (day.volume / day.maxVolume) * 100 : 0;
            return (
              <div key={index} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex items-end justify-center h-16">
                  <div
                    className={`w-full max-w-8 rounded-t-md transition-all ${
                      day.volume > 0 ? "bg-primary" : "bg-muted"
                    }`}
                    style={{ height: `${Math.max(heightPercent, 4)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground font-medium">{day.day}</span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-2xl font-mono font-bold">{totalWorkouts}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Workouts</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-mono font-bold">{totalHours.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Hours</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-mono font-bold">{(totalDistance / 1000).toFixed(1)}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">KM</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
