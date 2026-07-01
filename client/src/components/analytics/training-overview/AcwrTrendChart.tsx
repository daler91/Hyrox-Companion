import type { LoadGovernorAcwrZone, TrainingLoadOverview, TrainingMonotonyZone } from "@shared/schema";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_CARD_CLASS,
  COLOR_GREEN,
  COLOR_PRIMARY,
  formatChartDate,
  GRID_BORDER,
  GRID_DASH,
  MUTED_FG,
} from "../chartConstants";
import { ChartExplanation } from "./ChartExplanation";

const ZONE_LABELS: Record<LoadGovernorAcwrZone, string> = {
  insufficient_data: "Insufficient data",
  undertraining: "Under-training",
  sweet_spot: "Sweet spot",
  yellow: "Yellow load",
  danger: "Danger load",
};

const ZONE_CLASSES: Record<LoadGovernorAcwrZone, string> = {
  insufficient_data: "border-border bg-muted/40 text-muted-foreground",
  undertraining: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  sweet_spot: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  yellow: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

const MONOTONY_ZONE_CLASSES: Record<TrainingMonotonyZone, string> = {
  ok: "text-foreground",
  elevated: "text-amber-600 dark:text-amber-400",
  high_risk: "text-red-600 dark:text-red-400",
};

function formatAcwr(value: number | null): string {
  return value == null ? "N/A" : value.toFixed(2);
}

function formatMonotony(value: number | null): string {
  return value == null ? "N/A" : value.toFixed(2);
}

// TSB ("Form"): positive ⇒ rested/fresh, negative ⇒ carrying fatigue. Shown with
// an explicit sign so a glance distinguishes freshness from accumulated load.
function formatTsb(value: number | null): string {
  if (value == null) return "N/A";
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function tsbClass(value: number | null): string {
  if (value == null) return "text-foreground";
  if (value >= 5) return "text-emerald-600 dark:text-emerald-400"; // fresh / tapered
  if (value <= -25) return "text-red-600 dark:text-red-400"; // deep fatigue
  if (value < 0) return "text-amber-600 dark:text-amber-400"; // building fatigue
  return "text-foreground";
}

function AcwrTooltip({
  active,
  payload,
}: Readonly<{
  active?: boolean;
  payload?: Array<{
    value: number | null;
    payload?: {
      date: string;
      utss: number;
      zone: LoadGovernorAcwrZone;
      tsb: number | null;
      monotony: number | null;
      hrTss: number | null;
    };
  }>;
}>) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-popover text-popover-foreground border px-3 py-2 rounded shadow-md text-sm">
      <p className="font-semibold mb-1">{formatChartDate(point.date)}</p>
      <p>
        <span className="text-muted-foreground mr-2">ACWR:</span>
        <span className="font-medium">{formatAcwr(payload[0]?.value ?? null)}</span>
      </p>
      <p>
        <span className="text-muted-foreground mr-2">UTSS:</span>
        <span className="font-medium">{point.utss}</span>
      </p>
      <p>
        <span className="text-muted-foreground mr-2">Form (TSB):</span>
        <span className="font-medium">{formatTsb(point.tsb)}</span>
      </p>
      <p>
        <span className="text-muted-foreground mr-2">Monotony:</span>
        <span className="font-medium">{formatMonotony(point.monotony)}</span>
      </p>
      {point.hrTss != null && (
        <p>
          <span className="text-muted-foreground mr-2">hrTSS:</span>
          <span className="font-medium">{Math.round(point.hrTss)}</span>
        </p>
      )}
      <p className="text-muted-foreground">{ZONE_LABELS[point.zone]}</p>
    </div>
  );
}

export function AcwrTrendChart({
  trainingLoad,
  explanation,
}: Readonly<{ trainingLoad: TrainingLoadOverview; explanation?: string }>) {
  const chartData = trainingLoad.trend.filter((point) => point.acwr != null);
  const hasTrend = chartData.length > 1;
  // ⚡ Bolt Performance Optimization:
  // Replaced O(N) intermediate array allocation and spread operator (.map(...))
  // with an O(N) linear scan to avoid memory overhead and potential stack limits.
  let yMax = 2;
  for (const point of chartData) {
    if (point.acwr != null && point.acwr > yMax) {
      yMax = point.acwr;
    }
  }
  const restrictionCount = trainingLoad.activeRestrictions.length;

  return (
    <div className={CHART_CARD_CLASS} data-testid="acwr-trend-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Training Load Governor</p>
          <p className="text-xs text-muted-foreground">
            UTSS {Math.round(trainingLoad.currentUtss)} - ACWR {formatAcwr(trainingLoad.acwr)}
          </p>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-xs font-medium ${ZONE_CLASSES[trainingLoad.zone]}`}>
          {ZONE_LABELS[trainingLoad.zone]}
        </div>
      </div>

      {hasTrend ? (
        <div
          className="h-[180px] w-full sm:h-[220px]"
          data-testid="chart-acwr-trend"
          role="img"
          aria-label={`Line chart of acute-to-chronic workload ratio over ${chartData.length} days; current zone ${ZONE_LABELS[trainingLoad.zone]}, ACWR ${formatAcwr(trainingLoad.acwr)}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 5 }}>
              <CartesianGrid strokeDasharray={GRID_DASH} vertical={false} stroke={GRID_BORDER} />
              <ReferenceArea y1={0} y2={0.8} fill="#0ea5e9" fillOpacity={0.08} />
              <ReferenceArea y1={0.8} y2={1.3} fill={COLOR_GREEN} fillOpacity={0.1} />
              <ReferenceArea y1={1.3} y2={1.5} fill="#f59e0b" fillOpacity={0.12} />
              <ReferenceArea y1={1.5} y2={yMax} fill="#ef4444" fillOpacity={0.1} />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: MUTED_FG }}
              />
              <YAxis
                domain={[0, yMax]}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: MUTED_FG }}
              />
              <Tooltip
                cursor={{ stroke: MUTED_FG, strokeDasharray: GRID_DASH }}
                content={<AcwrTooltip />}
              />
              <ReferenceLine y={0.8} stroke={COLOR_GREEN} strokeDasharray="6 3" />
              <ReferenceLine y={1.3} stroke="#f59e0b" strokeDasharray="6 3" />
              <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="6 3" />
              <Line
                type="monotone"
                dataKey="acwr"
                stroke={COLOR_PRIMARY}
                strokeWidth={2}
                dot={{ r: 2, fill: COLOR_PRIMARY }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          More logged history is needed before the ACWR trend is meaningful.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <span className="font-medium text-foreground">{Math.round(trainingLoad.acuteAvg)}</span>{" "}
          acute UTSS
        </div>
        <div>
          <span className="font-medium text-foreground">{Math.round(trainingLoad.chronicAvg)}</span>{" "}
          chronic UTSS
        </div>
        <div>
          <span className={`font-medium ${tsbClass(trainingLoad.tsb)}`}>{formatTsb(trainingLoad.tsb)}</span>{" "}
          form (TSB)
        </div>
        <div>
          <span className={`font-medium ${MONOTONY_ZONE_CLASSES[trainingLoad.monotonyZone]}`}>
            {formatMonotony(trainingLoad.monotony)}
          </span>{" "}
          monotony
        </div>
        {trainingLoad.hrTss != null && (
          <div>
            <span className="font-medium text-foreground">{Math.round(trainingLoad.hrTss)}</span>{" "}
            hrTSS
          </div>
        )}
        <div>
          <span className="font-medium text-foreground">{restrictionCount}</span>{" "}
          active restriction{restrictionCount === 1 ? "" : "s"}
        </div>
      </div>

      {trainingLoad.downshiftRationale && (
        <p className="text-xs text-muted-foreground">{trainingLoad.downshiftRationale}</p>
      )}

      <ChartExplanation explanation={explanation} />
    </div>
  );
}
