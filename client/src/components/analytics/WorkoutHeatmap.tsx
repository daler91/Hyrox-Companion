import { useMemo } from "react";

import { toISODateString } from "@/lib/dateUtils";

import { CHART_CARD_CLASS } from "./chartConstants";
import { ChartExplanation } from "./training-overview/ChartExplanation";

const DAY_LABELS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];
const WEEKS_TO_SHOW = 16;
const WEEK_GRID_TEMPLATE = `repeat(${WEEKS_TO_SHOW}, minmax(2rem, 1fr))`;

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d: Date): string {
  // Local-TZ string so heatmap cells line up with workout entries
  // (which are stored in the user's local TZ).
  return toISODateString(d);
}

interface HeatmapCell {
  date: string;
  hasWorkout: boolean;
  isFuture: boolean;
  isOutOfRange: boolean;
}

const OUT_OF_RANGE_CELL_CLASS = "border border-dashed border-muted-foreground/30";

function getHeatmapCellColor(cell: HeatmapCell): string {
  if (cell.isFuture) return "bg-muted/30";
  if (cell.isOutOfRange) return OUT_OF_RANGE_CELL_CLASS;
  if (cell.hasWorkout) return "bg-primary";
  return "bg-muted/60";
}

function getHeatmapCellTitle(cell: HeatmapCell): string {
  if (cell.isOutOfRange) return `${cell.date} - Outside selected range`;
  return `${cell.date}${cell.hasWorkout ? " - Workout logged" : ""}`;
}

interface WorkoutHeatmapProps {
  readonly workoutDates: string[];
  /**
   * First day (YYYY-MM-DD) of the selected Analytics range. `workoutDates`
   * only covers that range, so an earlier day in the fixed 16-week grid has no
   * data rather than no workout; omitted for "All time".
   */
  readonly rangeStart?: string;
  readonly explanation?: string;
}

export function WorkoutHeatmap({ workoutDates, rangeStart, explanation }: WorkoutHeatmapProps) {
  const { grid, monthLabels, hasOutOfRange } = useMemo(() => {
    const dateSet = new Set(workoutDates);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startMonday = getMonday(today);
    startMonday.setDate(startMonday.getDate() - (WEEKS_TO_SHOW - 1) * 7);

    const weeks: HeatmapCell[][] = [];
    const months: Array<{ label: string; colStart: number }> = [];
    let lastMonth = -1;
    let anyOutOfRange = false;

    for (let w = 0; w < WEEKS_TO_SHOW; w++) {
      const week: HeatmapCell[] = [];
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(startMonday);
        cellDate.setDate(startMonday.getDate() + w * 7 + d);
        const dateStr = toDateStr(cellDate);
        const isFuture = cellDate > today;
        // A day before the selected range was never fetched, so drawing it as
        // a rest day invents a layoff (CL6 (CODEBASE_ANALYSIS_2026-10-03)).
        const isOutOfRange = rangeStart !== undefined && dateStr < rangeStart;
        if (isOutOfRange) anyOutOfRange = true;
        week.push({
          date: dateStr,
          hasWorkout: !isFuture && !isOutOfRange && dateSet.has(dateStr),
          isFuture,
          isOutOfRange,
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

    return { grid: weeks, monthLabels: months, hasOutOfRange: anyOutOfRange };
  }, [workoutDates, rangeStart]);

  return (
    <div className={CHART_CARD_CLASS}>
      <p className="text-sm font-semibold">Workout Consistency</p>
      <div className="overflow-x-auto overflow-y-hidden">
        <div className="min-w-[560px] w-full">
          <div className="flex gap-2">
            <div className="w-8 shrink-0" aria-hidden="true" />
            <div
              className="grid flex-1 gap-x-2 text-[10px] text-muted-foreground"
              style={{ gridTemplateColumns: WEEK_GRID_TEMPLATE }}
              data-testid="workout-heatmap-month-label-row"
            >
              {monthLabels.map((m, i) => {
                const nextStart = monthLabels[i + 1]?.colStart ?? WEEKS_TO_SHOW;
                const span = nextStart - m.colStart;
                return (
                  <div
                    key={`${m.label}-${m.colStart}`}
                    className="truncate"
                    style={{ gridColumn: `${m.colStart + 1} / span ${span}` }}
                    data-testid="workout-heatmap-month-label"
                  >
                    {m.label}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <div className="flex w-8 shrink-0 flex-col gap-1">
              {DAY_LABELS.map((day) => (
                <div
                  key={day.key}
                  className="flex h-7 items-center justify-end pr-1 text-[10px] text-muted-foreground"
                  data-testid="workout-heatmap-day-label"
                >
                  {day.label}
                </div>
              ))}
            </div>

            <div
              className="grid flex-1 gap-x-2"
              style={{ gridTemplateColumns: WEEK_GRID_TEMPLATE }}
              data-testid="workout-heatmap-grid"
              role="img"
              aria-label="Workout activity heatmap: each square is a day, shaded when a workout was logged, arranged by week."
            >
              {grid.map((week) => (
                <div
                  key={week[0].date}
                  className="flex flex-col items-center gap-1"
                  data-testid="workout-heatmap-week"
                >
                  {week.map((cell) => (
                    <div
                      key={cell.date}
                      className={`aspect-square w-full max-w-7 rounded-sm ${getHeatmapCellColor(cell)}`}
                      title={getHeatmapCellTitle(cell)}
                      data-testid="workout-heatmap-cell"
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-[10px] w-[10px] rounded-sm bg-muted/60" aria-hidden="true" />
              <span>Rest day</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-[10px] w-[10px] rounded-sm bg-primary" aria-hidden="true" />
              <span>Workout logged</span>
            </span>
            {hasOutOfRange && (
              <span className="inline-flex items-center gap-1" data-testid="workout-heatmap-out-of-range-legend">
                <span className={`h-[10px] w-[10px] rounded-sm ${OUT_OF_RANGE_CELL_CLASS}`} aria-hidden="true" />
                <span>Outside selected range</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <ChartExplanation explanation={explanation} />
    </div>
  );
}
