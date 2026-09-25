import {
  BODY_SYSTEM_META,
  describeBodySystemDivergence,
  formatLoadChange,
  hasBodySystemLoadData,
} from "@shared/bodySystemLoad";
import type {
  BodySystem,
  BodySystemLoadOverview,
  BodySystemLoadStatus,
  BodySystemLoadSummary,
  BodySystemWeek,
} from "@shared/schema";
import {
  ArrowUpToLine,
  BicepsFlexed,
  ChartColumn,
  CircleCheck,
  Dumbbell,
  Footprints,
  HeartPulse,
  Hourglass,
  type LucideIcon,
  Minus,
  Table2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { memo, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ExplanationTooltip } from "@/components/ui/explanation-tooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { CHART_CARD_CLASS, formatChartDate } from "../chartConstants";
import { ChartExplanation } from "./ChartExplanation";

const SYSTEM_ICONS: Record<BodySystem, LucideIcon> = {
  aerobic: HeartPulse,
  running_impact: Footprints,
  leg_muscle: Dumbbell,
  upper_pull: BicepsFlexed,
};

const MUTED_CHIP = "border-border bg-muted/40 text-muted-foreground";
const AMBER_CHIP =
  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

// Status is carried by an icon and a word, never by colour alone.
const STATUS_CHIPS: Record<
  BodySystemLoadStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  insufficient_data: { label: "Building baseline", icon: Hourglass, className: MUTED_CHIP },
  minimal: { label: "Minimal", icon: Minus, className: MUTED_CHIP },
  new: { label: "New load", icon: TrendingUp, className: AMBER_CHIP },
  low: {
    label: "Below usual",
    icon: TrendingDown,
    className:
      "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  },
  normal: {
    label: "Normal",
    icon: CircleCheck,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  high: { label: "High", icon: TrendingUp, className: AMBER_CHIP },
  very_high: {
    label: "Very high",
    icon: TriangleAlert,
    className:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
};

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatLoad(value: number): string {
  return numberFormat.format(value);
}

/** "This week" for the newest block, else its date range. */
function weekLabel(weeks: readonly BodySystemWeek[], index: number): string {
  if (index === weeks.length - 1) return "This week";
  const week = weeks.at(index);
  return week ? `${formatChartDate(week.start)} – ${formatChartDate(week.end)}` : "";
}

/** How this week compares, or why it can't yet. */
function comparisonText(summary: BodySystemLoadSummary): string | null {
  switch (summary.status) {
    case "insufficient_data":
      return "Needs three weeks of history to compare";
    case "minimal":
      return "Too little load to compare";
    case "new":
      return "Almost none in the previous four weeks";
    default:
      return summary.ratio == null || summary.baseline == null
        ? null
        : `${formatLoadChange(summary.ratio)} vs your usual week (${formatLoad(summary.baseline)})`;
  }
}

/** The line under the chips: the comparison, plus the peak a six-week high beat. */
function detailText(summary: BodySystemLoadSummary): string {
  const parts = [comparisonText(summary)];
  if (summary.sixWeekHigh && summary.previousPeak != null) {
    parts.push(`Previous peak ${formatLoad(summary.previousPeak)}`);
  }
  return parts.filter(Boolean).join(". ");
}

function Chip({
  label,
  icon: Icon,
  className,
}: Readonly<{ label: string; icon: LucideIcon; className: string }>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Six rolling weeks as thin columns: this week in the accent, the five before
 * it recessive, and the usual week as a dashed rule. Each tile has its own
 * scale — the systems are compared with themselves, never with each other —
 * so the numbers carry the magnitude and the table view carries every value.
 */
function WeeklyBars({
  summary,
  weeks,
}: Readonly<{ summary: BodySystemLoadSummary; weeks: readonly BodySystemWeek[] }>) {
  const label = BODY_SYSTEM_META[summary.system].label;
  let max = summary.baseline ?? 0;
  for (const value of summary.weekly) if (value != null && value > max) max = value;
  const scale = max > 0 ? max : 1;
  const described = summary.weekly
    .map(
      (value, index) =>
        `${weekLabel(weeks, index)}: ${value == null ? "no history" : formatLoad(value)}`,
    )
    .join("; ");

  return (
    <div>
      <div
        className="relative flex h-14 items-end justify-between gap-1.5"
        role="img"
        aria-label={`${label} load over six weeks. ${described}.`}
        data-testid={`body-system-bars-${summary.system}`}
      >
        {summary.baseline != null && summary.baseline > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground"
            style={{ bottom: `${(summary.baseline / scale) * 100}%` }}
            data-testid={`body-system-usual-${summary.system}`}
          />
        )}
        {summary.weekly.map((value, index) => {
          const week = weeks.at(index);
          const isCurrent = index === summary.weekly.length - 1;
          return (
            <Tooltip key={week?.start ?? index}>
              <TooltipTrigger asChild>
                <div className="flex h-full max-w-6 flex-1 items-end">
                  {value == null ? (
                    <div className="h-px w-full bg-border" />
                  ) : (
                    <div
                      className={cn(
                        "w-full",
                        value > 0 ? "rounded-t" : "",
                        isCurrent ? "bg-chart-1" : "bg-neutral-400 dark:bg-neutral-600",
                      )}
                      // A zero week still shows a sliver, so it reads as "none", not "missing".
                      style={{ height: value > 0 ? `max(${(value / scale) * 100}%, 3px)` : "2px" }}
                      data-testid={isCurrent ? `body-system-current-${summary.system}` : undefined}
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-semibold">
                  {value == null ? "No history yet" : formatLoad(value)}
                </p>
                <p className="text-xs text-muted-foreground">{weekLabel(weeks, index)}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div
        className="mt-1 flex justify-between text-[11px] text-muted-foreground"
        aria-hidden="true"
      >
        <span>{weeks[0] ? formatChartDate(weeks[0].start) : ""}</span>
        <span>This week</span>
      </div>
    </div>
  );
}

function SystemTile({
  summary,
  weeks,
}: Readonly<{ summary: BodySystemLoadSummary; weeks: readonly BodySystemWeek[] }>) {
  const meta = BODY_SYSTEM_META[summary.system];
  const Icon = SYSTEM_ICONS[summary.system];
  const chip = STATUS_CHIPS[summary.status];
  // Phones: the bars sit beside the numbers, so all four systems fit on a
  // screen and the divergence reads at a glance. Wider: stacked tiles, with
  // the detail line held to two lines so the bars align across a row.
  return (
    <div
      className="space-y-2 rounded-lg border bg-muted/30 p-3"
      data-testid={`body-system-${summary.system}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-semibold">{meta.label}</p>
        <ExplanationTooltip explanation={meta.description} subject={meta.label} />
      </div>
      <div className="flex items-end gap-3 sm:flex-col sm:items-stretch sm:gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="text-2xl font-bold" data-testid={`body-system-value-${summary.system}`}>
              {formatLoad(summary.current)}
            </p>
            <p className="text-xs text-muted-foreground">this week</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip {...chip} />
            {summary.sixWeekHigh && (
              <Chip label="6-week high" icon={ArrowUpToLine} className={AMBER_CHIP} />
            )}
          </div>
          <p
            className="text-xs text-muted-foreground sm:min-h-8"
            data-testid={`body-system-detail-${summary.system}`}
          >
            {detailText(summary)}
          </p>
        </div>
        <div className="w-32 shrink-0 sm:w-full">
          <WeeklyBars summary={summary} weeks={weeks} />
        </div>
      </div>
    </div>
  );
}

function LoadTable({ overview, id }: Readonly<{ overview: BodySystemLoadOverview; id: string }>) {
  return (
    <div id={id} className="overflow-x-auto" data-testid="body-system-table">
      <table className="w-full text-xs">
        <caption className="sr-only">Weekly load by body system, in session RPE × minutes</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              System
            </th>
            {overview.weeks.map((week, index) => (
              <th key={week.start} scope="col" className="py-1.5 pr-3 text-right font-medium">
                {index === overview.weeks.length - 1 ? "This week" : formatChartDate(week.start)}
              </th>
            ))}
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Usual week
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {overview.systems.map((summary) => (
            <tr key={summary.system} className="border-b last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                {BODY_SYSTEM_META[summary.system].label}
              </th>
              {summary.weekly.map((value, index) => (
                <td
                  key={overview.weeks.at(index)?.start ?? index}
                  className="py-1.5 pr-3 text-right tabular-nums"
                >
                  {value == null ? "—" : formatLoad(value)}
                </td>
              ))}
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {summary.baseline == null ? "—" : formatLoad(summary.baseline)}
              </td>
              <td className="py-1.5">
                {STATUS_CHIPS[summary.status].label}
                {summary.sixWeekHigh ? ", 6-week high" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function coverageNotes(overview: BodySystemLoadOverview): string[] {
  const notes: string[] = [];
  if (overview.estimatedSessions > 0) {
    notes.push(
      `${overview.estimatedSessions} of ${overview.sessionCount} sessions had no RPE or duration logged, so their load is estimated — rate your sessions to sharpen the split.`,
    );
  }
  if (overview.unattributedSessions > 0) {
    notes.push(
      `${overview.unattributedSessions} ${overview.unattributedSessions === 1 ? "session" : "sessions"} couldn't be split because no exercises were logged.`,
    );
  }
  if (overview.unscoredSessions > 0) {
    notes.push(
      `${overview.unscoredSessions} ${overview.unscoredSessions === 1 ? "session has" : "sessions have"} no duration or exercises and ${overview.unscoredSessions === 1 ? "isn't" : "aren't"} counted.`,
    );
  }
  return notes;
}

/**
 * Load by body system: one training-load number split into the four systems a
 * hybrid athlete actually stresses, each read against its own usual week. The
 * point is the divergence the single number hides — "leg load is at a six-week
 * high while aerobic load is normal" — so that sentence leads the card.
 */
export const BodySystemLoadCard = memo(function BodySystemLoadCard({
  bodySystemLoad,
  explanation,
}: Readonly<{ bodySystemLoad: BodySystemLoadOverview; explanation?: string }>) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  if (!hasBodySystemLoadData(bodySystemLoad)) return null;

  const divergence = describeBodySystemDivergence(bodySystemLoad);
  const severe = bodySystemLoad.systems.some((s) => s.status === "very_high");
  const notes = coverageNotes(bodySystemLoad);

  return (
    <div className={CHART_CARD_CLASS} data-testid="body-system-load-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Load by body system</p>
          <p className="text-xs text-muted-foreground">
            Session RPE × minutes, split by what each session trained. Rolling 7-day weeks.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowTable((open) => !open);
          }}
          aria-expanded={showTable}
          aria-controls={showTable ? tableId : undefined}
          data-testid="body-system-table-toggle"
        >
          {showTable ? <ChartColumn aria-hidden="true" /> : <Table2 aria-hidden="true" />}
          {showTable ? "Show as chart" : "Show as table"}
        </Button>
      </div>

      {divergence && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            severe ? STATUS_CHIPS.very_high.className : AMBER_CHIP,
          )}
          data-testid="body-system-divergence"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{divergence}</p>
        </div>
      )}

      {showTable ? (
        <LoadTable overview={bodySystemLoad} id={tableId} />
      ) : (
        <TooltipProvider>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {bodySystemLoad.systems.map((summary) => (
              <SystemTile key={summary.system} summary={summary} weeks={bodySystemLoad.weeks} />
            ))}
          </div>
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
            aria-label="Chart key"
          >
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-chart-1" aria-hidden="true" />
              This week
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm bg-neutral-400 dark:bg-neutral-600"
                aria-hidden="true"
              />
              Previous weeks
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="w-3 border-t border-dashed border-muted-foreground"
                aria-hidden="true"
              />
              Your usual week (average of the four before this one)
            </li>
          </ul>
        </TooltipProvider>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Each system is compared only with its own history, so the numbers aren&apos;t comparable
          across systems.
        </p>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>

      <ChartExplanation explanation={explanation} />
    </div>
  );
});
