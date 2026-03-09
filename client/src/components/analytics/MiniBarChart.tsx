interface ExerciseAnalyticDay {
  date: string;
  totalVolume: number;
  maxWeight: number;
  totalSets: number;
  totalReps: number;
  totalDistance: number;
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MiniBarChart({ data, valueKey, color, label }: { data: ExerciseAnalyticDay[]; valueKey: keyof ExerciseAnalyticDay; color: string; label: string }) {
  if (data.length === 0) return null;
  const values = data.map(d => Number(d[valueKey]) || 0);
  const max = Math.max(...values, 1);
  const chartHeight = 80;

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <div className="flex items-end gap-px" style={{ height: chartHeight }} data-testid={`chart-${valueKey}`}>
        {data.map((d, i) => {
          const val = Number(d[valueKey]) || 0;
          const h = (val / max) * chartHeight;
          return (
            <div
              key={d.date}
              className="flex-1 min-w-0 group relative"
              style={{ height: chartHeight }}
            >
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-t-sm ${color}`}
                style={{ height: Math.max(h, 2) }}
              />
              <div className="invisible group-hover:visible absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground border px-2 py-0.5 rounded text-xs whitespace-nowrap z-50">
                {formatDate(d.date)}: {val}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/60">
        {data.length > 0 && <span>{formatDate(data[0].date)}</span>}
        {data.length > 1 && <span>{formatDate(data[data.length - 1].date)}</span>}
      </div>
    </div>
  );
}

export type { ExerciseAnalyticDay };
