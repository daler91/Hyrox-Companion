import { useMemo } from "react";

import { CHART_CARD_CLASS } from "./chartConstants";

const DAY_LABELS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "" },
  { key: "sun", label: "Sun" },
];
const WEEKS_TO_SHOW = 16;

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getHeatmapCellColor(cell: { isFuture: boolean; hasWorkout: boolean }): string {
  if (cell.isFuture) return "bg-muted/30";
  if (cell.hasWorkout) return "bg-primary";
  return "bg-muted/60";
}

interface WorkoutHeatmapProps {
  readonly workoutDates: string[];
}

export function WorkoutHeatmap({ workoutDates }: WorkoutHeatmapProps) {
  const { grid, monthLabels } = useMemo(() => {
    const dateSet = new Set(workoutDates);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startMonday = getMonday(today);
    startMonday.setDate(startMonday.getDate() - (WEEKS_TO_SHOW - 1) * 7);

    const weeks: Array<Array<{ date: string; hasWorkout: boolean; isFuture: boolean }>> = [];
    const months: Array<{ label: string; colStart: number }> = [];
    let lastMonth = -1;

    for (let w = 0; w < WEEKS_TO_SHOW; w++) {
      const week: Array<{ date: string; hasWorkout: boolean; isFuture: boolean }> = [];
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(startMonday);
        cellDate.setDate(startMonday.getDate() + w * 7 + d);
        const dateStr = toDateStr(cellDate);
        const isFuture = cellDate > today;
        week.push({
          date: dateStr,
          hasWorkout: !isFuture && dateSet.has(dateStr),
          isFuture,
        });

        if (d === 0 && cellDate.getMonth() !== lastMonth) {
          lastMonth = cellDate.getMonth();
          months.push({
            label: cellDate.toLocaleDateString("en-US", { month: "short" }),
            colStart: w,
          });
        }
      }
      weeks.push(week);
    }

    return { grid: weeks, monthLabels: months };
  }, [workoutDates]);

  const workoutCount = workoutDates.length;

  return (
    <div className={CHART_CARD_CLASS} role="region" aria-label="Workout consistency heatmap">
      <p className="text-sm font-semibold" id="heatmap-title">
        Workout Consistency
      </p>
      <p className="sr-only">
        {workoutCount} {workoutCount === 1 ? "workout" : "workouts"} logged in the last{" "}
        {WEEKS_TO_SHOW} weeks.
      </p>
      <div className="overflow-x-auto" aria-hidden="true">
        <div className="min-w-[400px]">
          {/* Month labels */}
          <div className="flex ml-8 mb-1 text-[10px] text-muted-foreground">
            {monthLabels.map((m) => (
              <div
                key={`${m.label}-${m.colStart}`}
                className="absolute"
                style={{ marginLeft: `${m.colStart * 18}px` }}
              >
                {m.label}
              </div>
            ))}
          </div>
          <div className="relative mt-4">
            {/* Month labels row - relative positioning */}
            <div className="flex ml-8 mb-1 h-4">
              {monthLabels.map((m, i) => {
                const nextStart = monthLabels[i + 1]?.colStart ?? WEEKS_TO_SHOW;
                const span = nextStart - m.colStart;
                return (
                  <div
                    key={`${m.label}-${m.colStart}`}
                    className="text-[10px] text-muted-foreground shrink-0"
                    style={{ width: `${span * 18}px` }}
                  >
                    {m.label}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-0">
              {/* Day labels */}
              <div className="flex flex-col gap-[2px] mr-1 shrink-0">
                {DAY_LABELS.map((day) => (
                  <div
                    key={day.key}
                    className="h-[14px] w-6 text-[10px] text-muted-foreground flex items-center justify-end pr-1"
                  >
                    {day.label}
                  </div>
                ))}
              </div>

              {/* Grid */}
              <div className="flex gap-[2px]">
                {grid.map((week) => (
                  <div key={week[0].date} className="flex flex-col gap-[2px]">
                    {week.map((cell) => (
                      <div
                        key={cell.date}
                        className={`h-[14px] w-[14px] rounded-sm ${getHeatmapCellColor(cell)}`}
                        title={`${cell.date}${cell.hasWorkout ? " - Workout logged" : ""}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
            <span>Less</span>
            <div className="h-[10px] w-[10px] rounded-sm bg-muted/60" />
            <div className="h-[10px] w-[10px] rounded-sm bg-primary/40" />
            <div className="h-[10px] w-[10px] rounded-sm bg-primary" />
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
