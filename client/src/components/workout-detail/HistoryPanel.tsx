import { format, parseISO } from "date-fns";

import type { WorkoutHistoryStats } from "@/lib/api";

interface HistoryPanelProps {
  readonly stats: WorkoutHistoryStats | undefined;
  readonly adherencePct?: number | null;
  readonly isLoading?: boolean;
}

/**
 * Compact sidebar panel showing last-same-focus date, PR count, and the
 * surrounding block's average RPE. Stats come from
 * GET /api/v1/workouts/:id/history; see server/storage/workouts.ts
 * getWorkoutHistoryStats() for the exact semantics of each field.
 */
export function HistoryPanel({ stats, adherencePct, isLoading }: HistoryPanelProps) {
  const lastTime = stats?.lastSameFocus ? formatDate(stats.lastSameFocus.date) : null;
  const prCount = stats?.prSetCount ?? null;
  const blockAvg = stats?.blockAvgRpe ?? null;
  const adherence = adherencePct == null ? null : `${adherencePct}%`;

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      aria-label="Workout history"
      data-testid="history-panel"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</div>
      <dl className="flex flex-col gap-2 text-sm">
        <HistoryRow label="Last time" value={lastTime} loading={isLoading} />
        <HistoryRow label="PR sets" value={prCount == null ? null : String(prCount)} loading={isLoading} />
        <HistoryRow
          label="Block avg"
          value={blockAvg == null ? null : `RPE ${blockAvg.toFixed(1)}`}
          loading={isLoading}
        />
        <HistoryRow
          label="Adherence"
          value={adherence}
          loading={isLoading}
        />
      </dl>
    </section>
  );
}

function HistoryRow({ label, value, loading }: Readonly<{ label: string; value: string | null; loading?: boolean }>) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">
        {loading ? <span className="text-muted-foreground">…</span> : (value ?? <span className="text-muted-foreground">—</span>)}
      </dd>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d");
  } catch {
    return iso;
  }
}
