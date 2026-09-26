import type { SessionGradeWeek } from "@shared/schema";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_CARD_CLASS, formatChartDate, GRID_BORDER, GRID_DASH, MUTED_CURSOR, MUTED_FG } from "../chartConstants";
import { GRADE_SERIES, type GradeChartRow, phaseLabel, toGradeChartRow } from "./gradeChartData";

/** The card surface, used as a 2px gap between stacked segments. */
const SEGMENT_GAP = "hsl(var(--card))";

function verdictLine(label: string, parts: [string, number][]): string | null {
  const shown = parts.filter(([, count]) => count > 0).map(([word, count]) => `${count} ${word}`);
  return shown.length > 0 ? `${label}: ${shown.join(", ")}` : null;
}

function WeekTooltip({
  active,
  payload,
}: Readonly<{ active?: boolean; payload?: Array<{ payload?: GradeChartRow }> }>) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const { easy, threshold, plannedGradeable, pending } = row.counts;
  const heading = [
    `Week ${row.weekNumber}`,
    phaseLabel(row.phase),
    row.deload ? "Deload" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    verdictLine("Easy", [
      ["stayed easy", easy.onTarget],
      ["crept up", easy.creptUp],
      ["too hard", easy.tooHard],
      ["can't tell", easy.inconclusive + easy.ungradeable],
    ]),
    verdictLine("Threshold", [
      ["held", threshold.onTarget],
      ["drifted harder", threshold.driftedHarder],
      ["under", threshold.under],
      ["can't tell", threshold.inconclusive + threshold.ungradeable],
    ]),
  ].filter((line): line is string => line !== null);
  return (
    <div className="max-w-xs rounded border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="mb-1 font-semibold">{heading}</p>
      {row.weekStart ? <p className="mb-1 text-xs text-muted-foreground">From {formatChartDate(row.weekStart)}</p> : null}
      {lines.length > 0 ? lines.map((line) => <p key={line}>{line}</p>) : <p className="text-muted-foreground">No graded runs</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        {plannedGradeable} easy/threshold {plannedGradeable === 1 ? "run" : "runs"} planned
        {pending > 0 ? ` · ${pending} waiting on detail` : ""}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Chart legend">
      {GRADE_SERIES.map((series) => (
        <li key={series.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.color }} aria-hidden="true" />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Graded runs per plan week, stacked by how they went. Deload weeks are
 * shaded. The block table below it carries the same numbers as text.
 */
export function WeeklyGradesChart({ weeks }: Readonly<{ weeks: SessionGradeWeek[] }>) {
  const rows = weeks.map(toGradeChartRow);
  const graded = rows.reduce((sum, row) => sum + row.onTarget + row.partial + row.missed, 0);
  const onTarget = rows.reduce((sum, row) => sum + row.onTarget, 0);
  const lastSeries = GRADE_SERIES.at(-1)?.key;
  return (
    <div className={CHART_CARD_CLASS}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Graded runs by plan week</p>
        <Legend />
      </div>
      <div
        className="h-[180px] w-full sm:h-[220px]"
        data-testid="chart-session-grades-weekly"
        role="img"
        aria-label={`Stacked bar chart of graded runs across ${rows.length} plan weeks: ${onTarget} of ${graded} did their job`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray={GRID_DASH} vertical={false} stroke={GRID_BORDER} />
            <XAxis dataKey="week" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: MUTED_FG }} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: MUTED_FG }} allowDecimals={false} />
            <Tooltip cursor={{ fill: MUTED_CURSOR }} content={<WeekTooltip />} />
            {rows
              .filter((row) => row.deload)
              .map((row) => (
                <ReferenceArea key={row.week} x1={row.week} x2={row.week} fill={MUTED_FG} fillOpacity={0.08} />
              ))}
            {GRADE_SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                stackId="grades"
                fill={series.color}
                stroke={SEGMENT_GAP}
                strokeWidth={2}
                maxBarSize={36}
                radius={series.key === lastSeries ? [4, 4, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Shaded weeks are deloads.</p>
    </div>
  );
}
