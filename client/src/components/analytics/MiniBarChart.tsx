import { useState } from "react";

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

const getFillColor = (colorStr: string) => {
  if (colorStr.includes("primary")) return "#ea580c";
  if (colorStr.includes("purple")) return "#a855f7";
  if (colorStr.includes("blue")) return "#3b82f6";
  if (colorStr.includes("green")) return "#22c55e";
  return "#64748b";
};

export function MiniBarChart({
  data,
  valueKey,
  color,
  label,
}: Readonly<{
  data: ExerciseAnalyticDay[];
  valueKey: keyof ExerciseAnalyticDay;
  color: string;
  label: string;
}>) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const fillColor = getFillColor(color);

  // Calculate max value for scaling
  const values = data.map((d) => Number(d[valueKey]) || 0);
  const maxVal = Math.max(...values, 1); // Avoid division by zero

  // Chart dimensions

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div
        className="h-[200px] w-full relative flex items-end justify-between pt-4 pb-6"
        data-testid={`chart-${valueKey}`}
      >
        {/* Y-axis grid lines (approximate for aesthetics) */}
        <div className="absolute inset-0 flex flex-col justify-between pb-6 pointer-events-none opacity-20">
          <div className="w-full border-t border-dashed border-border"></div>
          <div className="w-full border-t border-dashed border-border"></div>
          <div className="w-full border-t border-dashed border-border"></div>
          <div className="w-full border-t border-dashed border-border"></div>
        </div>

        {data.map((entry, i) => {
          const val = Number(entry[valueKey]) || 0;
          const percentage = (val / maxVal) * 100;
          const barHeight = Math.max(percentage, 2); // Minimum 2% height for visibility
          const isHovered = hoveredIndex === i;

          return (
            <div
              key={`cell-${entry.date}`}
              className="relative flex flex-col items-center justify-end h-full flex-1 group"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {isHovered && (
                <div className="absolute bottom-full mb-2 z-10 w-max pointer-events-none">
                  <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
                    <p className="font-semibold mb-1">{formatDate(entry.date)}</p>
                    <p>
                      <span className="text-muted-foreground mr-2">{label}:</span>
                      <span className="font-medium">{val}</span>
                    </p>
                  </div>
                </div>
              )}
              <div
                className="w-full max-w-[40px] rounded-t-sm transition-all duration-300"
                style={{
                  height: `${barHeight}%`,
                  backgroundColor: fillColor,
                  opacity: isHovered ? 1 : 0.8,
                }}
              />
              <div className="absolute top-full mt-2 w-max text-[10px] text-muted-foreground -translate-x-1/2 left-1/2 whitespace-nowrap hidden sm:block">
                {i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0
                  ? formatDate(entry.date)
                  : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { ExerciseAnalyticDay };
